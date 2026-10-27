/* Envoi des e-mails (nodemailer) + journal dans la table `emails`.
   Modes (variable MAIL_MODE, ou déduit de SMTP_HOST) :
     smtp        : envoi réel via votre serveur SMTP (Gmail, Outlook, serveur du ministère...)
     ethereal    : fausse boîte de test en ligne (aperçu via un lien, rien n'est livré)
     simulation  : aucun envoi, l'e-mail est seulement enregistré (défaut si SMTP non configuré) */
const nodemailer = require("nodemailer");
const { db } = require("./db");
const { genererRecu } = require("./recu_pdf");

let transport = null;
let transportMode = null;

const mode = () => {
  const m = (process.env.MAIL_MODE || "").trim().toLowerCase();
  if (["smtp", "ethereal", "simulation"].includes(m)) return m;
  return process.env.SMTP_HOST ? "smtp" : "simulation";
};
const expediteur = () => process.env.MAIL_FROM || process.env.SMTP_USER || '"Gestion des Déplacements" <no-reply@justice.demo>';

function configPublique() {
  const m = mode();
  return { mode: m, host: m === "smtp" ? process.env.SMTP_HOST : m === "ethereal" ? "ethereal.email" : null, from: expediteur() };
}

async function obtenirTransport() {
  const m = mode();
  if (transport && transportMode === m) return transport;
  if (m === "ethereal") {
    const acc = await nodemailer.createTestAccount();
    transport = nodemailer.createTransport({ host: acc.smtp.host, port: acc.smtp.port, secure: acc.smtp.secure, auth: { user: acc.user, pass: acc.pass } });
  } else {
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  transportMode = m;
  return transport;
}

/* Envoie (ou simule) un e-mail et le consigne dans le journal. Ne lève jamais d'exception. */
async function envoyerEmail({ to, sujet, texte, html, pieces = [], deplacementId = null }) {
  const m = mode();
  const id = db.prepare(`INSERT INTO emails (destinataire, sujet, corps, piece_jointe, statut, mode, deplacement_id)
    VALUES (?,?,?,?,?,?,?)`).run(to || "(aucune adresse)", sujet, texte, pieces.map((p) => p.filename).join(", ") || null, "en cours", m, deplacementId).lastInsertRowid;
  const maj = (statut, erreur = null, apercu = null) =>
    db.prepare("UPDATE emails SET statut = ?, erreur = ?, apercu = ? WHERE id = ?").run(statut, erreur, apercu, id);
  try {
    if (!to) { maj("ignoré", "Aucune adresse e-mail pour ce destinataire."); return false; }
    if (m === "simulation") { maj("simulé"); return true; }
    const t = await obtenirTransport();
    const r = await t.sendMail({ from: expediteur(), to, subject: sujet, text: texte, html, attachments: pieces });
    maj("envoyé", null, m === "ethereal" ? nodemailer.getTestMessageUrl(r) || null : null);
    return true;
  } catch (e) {
    console.error("Échec d'envoi d'e-mail :", e.message);
    maj("échec", String(e.message).slice(0, 300));
    return false;
  }
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "-");
const fmtDuree = (min) => { const h = Math.floor(min / 60), r = min % 60; return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`; };

/* Contenu de l'e-mail de décision (validation ou refus) */
function composerDecision(d, decideur) {
  const approuve = d.statut === "Validée";
  const qui = `${decideur.prenom} ${decideur.nom}` + (decideur.fonction ? ` (${decideur.fonction})` : "");
  const lignes = [
    ["Numéro", d.numero], ["Destination", d.tribunal], ["Mission", `${d.mission} : ${d.tache}`],
    ["Départ", `${fmtDate(d.date_depart)} à ${d.heure_debut}`], ["Fin", `${fmtDate(d.date_arrivee)} à ${d.heure_fin}`],
    ["Durée", fmtDuree(d.duree_minutes)],
    ["Véhicule", [d.type_vehicule, d.marque_vehicule, d.matricule_vehicule].filter(Boolean).join(" - ")],
  ];
  const intro = approuve
    ? `Votre demande de déplacement a été approuvée par ${qui}.`
    : `Votre demande de déplacement a été refusée par ${qui}.`;
  const sujet = approuve
    ? `Déplacement ${d.numero} approuvé - ${d.tribunal}`
    : `Déplacement ${d.numero} refusé`;
  const motif = !approuve && d.motif_refus ? `\nMotif du refus : ${d.motif_refus}\n` : "";
  const suite = approuve
    ? "Votre reçu est joint à ce message (PDF). Bonne mission !"
    : "Vous pouvez effectuer une nouvelle demande depuis l'application. Le reçu correspondant est joint à titre d'information.";

  const texte = `Bonjour ${d.prenom} ${d.nom},\n\n${intro}\n\n` +
    lignes.map(([k, v]) => `- ${k} : ${v}`).join("\n") + `\n${motif}\n${suite}\n\nMinistère de la Justice - Gestion des Déplacements Officiels\n(Message automatique, merci de ne pas répondre.)`;

  const couleur = approuve ? "#1d6b32" : "#b3261e";
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#1f2933">
    <div style="background:#003366;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0"><strong>Ministère de la Justice</strong><br><span style="font-size:13px">Gestion des Déplacements Officiels</span></div>
    <div style="border:1px solid #d5dde8;border-top:0;padding:20px;border-radius:0 0 8px 8px">
      <p>Bonjour <strong>${esc(d.prenom)} ${esc(d.nom)}</strong>,</p>
      <p style="color:${couleur};font-weight:600">${esc(intro)}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">${lignes.map(([k, v]) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;color:#6b7a8c;width:120px">${esc(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0"><strong>${esc(v)}</strong></td></tr>`).join("")}</table>
      ${!approuve && d.motif_refus ? `<p style="background:#fadbd8;padding:10px;border-radius:6px"><strong>Motif du refus :</strong> ${esc(d.motif_refus)}</p>` : ""}
      <p>${esc(suite)}</p>
      <p style="font-size:12px;color:#6b7a8c">Message automatique, merci de ne pas répondre.</p>
    </div></div>`;
  return { sujet, texte, html };
}

/* Appelée après une validation ou un refus : e-mail à l'agent avec le reçu PDF */
async function notifierDecision(d, decideur) {
  if (!["Validée", "Refusée"].includes(d.statut)) return;
  const { sujet, texte, html } = composerDecision(d, decideur);
  let pieces = [];
  try { pieces = [{ filename: `recu_${d.numero}.pdf`, content: await genererRecu(d), contentType: "application/pdf" }]; }
  catch (e) { console.error("Génération du PDF impossible :", e.message); }
  return envoyerEmail({ to: d.email, sujet, texte, html, pieces, deplacementId: d.id });
}


/* ------------------------------------------------------------------ */
/* Rappels et relances automatiques                                    */
/* ------------------------------------------------------------------ */
const appUrl = () => (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");

function miseEnForme({ salutation, intro, couleur, lignes, bloc, suite, lien }) {
  const texte = `${salutation},\n\n${intro}\n\n` + lignes.map(([k, v]) => `- ${k} : ${v}`).join("\n") +
    `${bloc ? `\n\n${bloc}` : ""}\n\n${suite}${lien ? `\n${lien.url}` : ""}\n\nMinistère de la Justice - Gestion des Déplacements Officiels\n(Message automatique, merci de ne pas répondre.)`;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#1f2933">
    <div style="background:#003366;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0"><strong>Ministère de la Justice</strong><br><span style="font-size:13px">Gestion des Déplacements Officiels</span></div>
    <div style="border:1px solid #d5dde8;border-top:0;padding:20px;border-radius:0 0 8px 8px">
      <p>${esc(salutation)},</p>
      <p style="color:${couleur};font-weight:600">${esc(intro)}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">${lignes.map(([k, v]) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;color:#6b7a8c;width:120px">${esc(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0"><strong>${esc(v)}</strong></td></tr>`).join("")}</table>
      ${bloc ? `<p style="background:#fff3cd;padding:10px;border-radius:6px">${esc(bloc)}</p>` : ""}
      <p>${esc(suite)}</p>
      ${lien ? `<p><a href="${esc(lien.url)}" style="background:#0055aa;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">${esc(lien.libelle)}</a></p>` : ""}
      <p style="font-size:12px;color:#6b7a8c">Message automatique, merci de ne pas répondre.</p>
    </div></div>`;
  return { texte, html };
}

const lignesMission = (d) => [
  ["Numéro", d.numero], ["Destination", d.tribunal], ["Mission", `${d.mission} : ${d.tache}`],
  ["Départ", `${fmtDate(d.date_depart)} à ${d.heure_debut}`], ["Fin", `${fmtDate(d.date_arrivee)} à ${d.heure_fin}`],
  ["Durée", fmtDuree(d.duree_minutes)],
  ["Véhicule", [d.type_vehicule, d.marque_vehicule, d.matricule_vehicule].filter(Boolean).join(" - ")],
];

/* Rappel envoyé à l'agent avant sa mission (reçu PDF joint) */
async function envoyerRappelMission(d, quand) {
  const { texte, html } = miseEnForme({
    salutation: `Bonjour ${d.prenom} ${d.nom}`,
    intro: `Rappel : votre mission à ${d.tribunal} a lieu ${quand} à ${d.heure_debut}.`,
    couleur: "#0b4f9c", lignes: lignesMission(d),
    suite: "Votre reçu est joint à ce message. Bonne mission !",
  });
  let pieces = [];
  try { pieces = [{ filename: `recu_${d.numero}.pdf`, content: await genererRecu(d), contentType: "application/pdf" }]; } catch (e) { /* pièce jointe facultative */ }
  return envoyerEmail({ to: d.email, sujet: `Rappel : mission ${quand} à ${d.tribunal} (${d.numero})`, texte, html, pieces, deplacementId: d.id });
}

/* Relance du responsable (niveau 1) ou escalade à l'administrateur (niveau 2) */
function envoyerRelance(d, destinataire, heures, escalade, responsables = "") {
  const intro = escalade
    ? `Escalade : la demande ${d.numero} de ${d.prenom} ${d.nom} attend une validation depuis plus de ${heures} h.`
    : `La demande ${d.numero} de ${d.prenom} ${d.nom} attend votre validation depuis plus de ${heures} h.`;
  const { texte, html } = miseEnForme({
    salutation: `Bonjour ${destinataire.prenom} ${destinataire.nom}`, intro, couleur: escalade ? "#b3261e" : "#8a6d00",
    lignes: [["Agent", `${d.prenom} ${d.nom} (${d.matricule})`], ["Service", d.service], ...lignesMission(d)],
    bloc: escalade ? `Le responsable du service${responsables ? ` (${responsables})` : ""} n'a pas encore traité cette demande. Le départ est prévu le ${fmtDate(d.date_depart)} à ${d.heure_debut}.`
                   : `Le départ est prévu le ${fmtDate(d.date_depart)} à ${d.heure_debut}.`,
    suite: "Merci de valider ou refuser cette demande dans l'application.",
    lien: { url: `${appUrl()}/deplacements.html?statut=En%20attente`, libelle: "Ouvrir les demandes en attente" },
  });
  return envoyerEmail({ to: destinataire.email, sujet: `${escalade ? "Escalade" : "Relance"} : demande ${d.numero} en attente de validation`, texte, html, deplacementId: d.id });
}

module.exports = { envoyerEmail, notifierDecision, composerDecision, configPublique, mode, envoyerRappelMission, envoyerRelance };

