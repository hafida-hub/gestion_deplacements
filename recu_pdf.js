/* Génération du reçu PDF côté serveur (pour la pièce jointe des e-mails) */
const PDFDocument = require("pdfkit");

const fmtDate = (iso) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "-");
function fmtDuree(min) {
  if (!min || min <= 0) return "-";
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

function genererRecu(d) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `Reçu ${d.numero}`, Author: "Ministère de la Justice" } });
    const bufs = [];
    doc.on("data", (b) => bufs.push(b));
    doc.on("end", () => resolve(Buffer.concat(bufs)));
    doc.on("error", reject);

    const W = 595.28;
    doc.rect(0, 0, W, 96).fill("#003366");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(20).text("Ministère de la Justice", 0, 28, { width: W, align: "center" });
    doc.font("Helvetica").fontSize(12).text("Gestion des Déplacements Officiels", 0, 58, { width: W, align: "center" });

    doc.fillColor("#003366").font("Helvetica-Bold").fontSize(17).text("ORDRE DE MISSION", 0, 122, { width: W, align: "center" });
    doc.fillColor("#3c3c3c").fontSize(12).text(`N° ${d.numero}`, 0, 146, { width: W, align: "center" });

    const valide = ["Validée", "Terminée"].includes(d.statut);
    const traite = d.traite_par_nom ? `${d.traite_par_prenom} ${d.traite_par_nom} (${d.traite_par}) le ${fmtDate(d.traite_le)}` : null;
    const vehicule = [d.type_vehicule, d.marque_vehicule, d.matricule_vehicule].filter(Boolean).join(" - ");
    const lignes = [
      ["AGENT"], ["Nom complet", `${d.prenom} ${d.nom}`], ["Matricule", d.matricule], ["Grade", d.grade], ["Fonction", d.fonction],
      ["Service", d.service], ["Téléphone", d.telephone],
      ["PÉRIODE ET HORAIRES"], ["Départ", `${fmtDate(d.date_depart)} à ${d.heure_debut}`], ["Arrivée / fin", `${fmtDate(d.date_arrivee)} à ${d.heure_fin}`],
      ["Durée du travail", fmtDuree(d.duree_minutes)],
      ["MISSION"], ["Destination", d.tribunal], ["Type de mission", d.mission], ["Tâche", d.tache], ["Véhicule", vehicule],
      ["VALIDATION"], ["Statut", d.statut],
    ];
    if (traite) lignes.push([d.statut === "Refusée" ? "Refusé par" : "Approuvé par", traite]);
    if (d.statut === "Refusée" && d.motif_refus) lignes.push(["Motif du refus", d.motif_refus]);

    let y = 176;
    const x1 = 56, x2 = 200, lv = W - x2 - 56;
    for (const [k, v] of lignes) {
      if (v === undefined) {
        y += 5;
        doc.rect(x1 - 6, y - 4, W - 100, 18).fill("#e6eef8");
        doc.fillColor("#003366").font("Helvetica-Bold").fontSize(10).text(k, x1, y, { lineBreak: false });
        y += 22;
      } else {
        const t = String(v || "-");
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#5a5a5a").text(k, x1, y, { width: 140, lineBreak: false });
        doc.font("Helvetica").fillColor("#141414").text(t, x2, y, { width: lv });
        y += Math.max(17, doc.heightOfString(t, { width: lv }) + 5);
      }
    }
    if (!valide) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#aa3c28")
        .text(`Attention : ce déplacement est « ${d.statut} ». Ce reçu n'est pas une autorisation de mission.`, 0, y + 10, { width: W, align: "center" });
    }

    const ys = 690;
    doc.strokeColor("#969696").fillColor("#3c3c3c").font("Helvetica-Bold").fontSize(10);
    doc.text("Signature de l'agent", 70, ys, { lineBreak: false });
    doc.text("Cachet et signature du responsable", W - 70 - 200, ys, { width: 200, align: "right", lineBreak: false });
    doc.rect(65, ys + 14, 180, 70).stroke(); doc.rect(W - 245, ys + 14, 180, 70).stroke();

    doc.font("Helvetica").fontSize(8).fillColor("#787878")
      .text(`Document édité le ${new Date().toLocaleString("fr-FR")}`, 0, 805, { width: W, align: "center", lineBreak: false });
    doc.end();
  });
}

module.exports = { genererRecu };
