require("dotenv").config({ quiet: true });
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { db, ready, initialiser, journaliser, SELECT_DEP } = require("./db");
const mail = require("./mail");
const taches = require("./taches");

const app = express();
const PORT = process.env.PORT || 3000;

const MISSIONS = ["Inspection", "Mission de représentation", "Livraison", "Mission administrative", "Mission judiciaire"];
const TYPES_VEHICULE = ["Voiture de service", "Bus", "Véhicule personnel en mission", "Autre"];
const TYPES_AVEC_PARC = ["Voiture de service", "Bus"];
const MAX_ECHECS = 5;
const BLOCAGE_MS = 15 * 60 * 1000;

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "same-origin");
  next();
});
app.use(session({
  name: "sid",
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 8 * 60 * 60 * 1000 },
}));

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */
const wrap = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) { console.error(e); res.status(500).json({ error: "Erreur interne du serveur." }); }
};
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const txt = (v, max = 200) => String(v ?? "").trim().slice(0, max);

function employeCourant(req) {
  if (!req.session.matricule) return null;
  const e = db.prepare(`SELECT e.*, s.nom AS service FROM employes e JOIN services s ON s.id = e.service_id
                        WHERE e.matricule = ?`).get(req.session.matricule);
  return e && e.actif ? e : null;
}

function auth(...roles) {
  return (req, res, next) => {
    const u = employeCourant(req);
    if (!u) return bad(res, "Non connecté.", 401);
    if (roles.length && !roles.includes(u.role)) return bad(res, "Accès refusé.", 403);
    req.user = u;
    next();
  };
}

const publicEmploye = (e) => {
  if (!e) return e;
  const { password_hash, echecs, bloque_jusqua, ...rest } = e;
  return rest;
};

const dt = (d, h) => `${d}T${h}`;
const valideDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d));
const valideHeure = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h);

// SELECT_DEP (jointure déplacement + employé + service + tribunal) est défini dans db.js

function peutVoir(u, d) {
  if (u.role === "admin") return true;
  if (u.role === "responsable") return d.service_id === u.service_id || d.matricule === u.matricule;
  return d.matricule === u.matricule;
}
function peutValider(u, d) {
  if (u.role === "admin") return true;
  return u.role === "responsable" && d.service_id === u.service_id && d.matricule !== u.matricule;
}
function droits(u, d) {
  const proprio = d.matricule === u.matricule;
  const valideur = peutValider(u, d);
  const modifiable = u.role === "admin" || (proprio && d.statut === "En attente");
  return {
    modifier: modifiable,
    supprimer: modifiable,
    valider: valideur && d.statut === "En attente",
    refuser: valideur && d.statut === "En attente",
    terminer: valideur && d.statut === "Validée",
    annuler: (proprio || valideur) && ["En attente", "Validée"].includes(d.statut),
  };
}
function avecDroits(u, d) {
  return { ...d, droits: droits(u, d) };
}

function prochainNumero() {
  const annee = new Date().getFullYear();
  const row = db.prepare("SELECT numero FROM deplacements WHERE numero LIKE ? ORDER BY numero DESC LIMIT 1").get(`DEP-${annee}-%`);
  const n = row ? parseInt(row.numero.split("-")[2], 10) + 1 : 1;
  return `DEP-${annee}-${String(n).padStart(4, "0")}`;
}

/* Conflits : même agent ou même véhicule déjà pris sur la période */
function chercherConflits({ matricule, vehicule_id, debut_dt, fin_dt, ignorerId = 0 }) {
  const base = `FROM deplacements d WHERE d.statut NOT IN ('Refusée','Annulée') AND d.id != @id
                AND d.debut_dt < @fin AND d.fin_dt > @debut`;
  const p = { id: ignorerId, debut: debut_dt, fin: fin_dt };
  const agent = db.prepare(`SELECT d.numero, d.debut_dt, d.fin_dt ${base} AND d.matricule = @mat`).get({ ...p, mat: matricule });
  const vehicule = vehicule_id
    ? db.prepare(`SELECT d.numero, d.debut_dt, d.fin_dt ${base} AND d.vehicule_id = @veh`).get({ ...p, veh: vehicule_id })
    : null;
  return { agent, vehicule };
}

/* Validation + normalisation d'un déplacement reçu du client */
function lireDeplacement(body, matricule, ignorerId = 0) {
  const d = {
    tribunal_id: parseInt(body.tribunal_id, 10),
    mission: txt(body.mission),
    tache: txt(body.tache, 500),
    date_depart: txt(body.date_depart, 10),
    heure_debut: txt(body.heure_debut, 5),
    date_arrivee: txt(body.date_arrivee, 10),
    heure_fin: txt(body.heure_fin, 5),
    type_vehicule: txt(body.type_vehicule),
    vehicule_id: null,
    marque_vehicule: txt(body.marque_vehicule, 60),
    matricule_vehicule: txt(body.matricule_vehicule, 30),
  };
  if (!db.prepare("SELECT 1 FROM tribunaux WHERE id = ?").get(d.tribunal_id)) return { erreur: "Tribunal invalide." };
  if (!MISSIONS.includes(d.mission)) return { erreur: "Type de mission invalide." };
  if (!d.tache) return { erreur: "La tâche est obligatoire." };
  if (!valideDate(d.date_depart) || !valideDate(d.date_arrivee)) return { erreur: "Dates invalides." };
  if (!valideHeure(d.heure_debut) || !valideHeure(d.heure_fin)) return { erreur: "Heures invalides (format HH:MM)." };
  if (!TYPES_VEHICULE.includes(d.type_vehicule)) return { erreur: "Type de véhicule invalide." };

  d.debut_dt = dt(d.date_depart, d.heure_debut);
  d.fin_dt = dt(d.date_arrivee, d.heure_fin);
  d.duree_minutes = Math.round((new Date(d.fin_dt) - new Date(d.debut_dt)) / 60000);
  if (d.duree_minutes <= 0) return { erreur: "La date/heure de fin doit être postérieure à la date/heure de début." };

  if (TYPES_AVEC_PARC.includes(d.type_vehicule)) {
    const v = db.prepare("SELECT * FROM vehicules WHERE id = ? AND actif = 1 AND type = ?")
      .get(parseInt(body.vehicule_id, 10), d.type_vehicule);
    if (!v) return { erreur: "Veuillez choisir un véhicule dans la liste." };
    d.vehicule_id = v.id;
    d.marque_vehicule = v.marque;
    d.matricule_vehicule = v.matricule;
  } else if (!d.marque_vehicule || !d.matricule_vehicule) {
    return { erreur: "Marque et matricule du véhicule obligatoires." };
  }

  const c = chercherConflits({ matricule, vehicule_id: d.vehicule_id, debut_dt: d.debut_dt, fin_dt: d.fin_dt, ignorerId });
  if (c.agent) return { erreur: `Conflit : vous avez déjà le déplacement ${c.agent.numero} sur cette période.`, code: 409 };
  if (c.vehicule) return { erreur: `Conflit : ce véhicule est déjà réservé (${c.vehicule.numero}) sur cette période.`, code: 409 };
  return { d };
}

/* ------------------------------------------------------------------ */
/* Pages protégées (redirection si non connecté)                       */
/* ------------------------------------------------------------------ */
const PAGES = { "/profil.html": [], "/formulaire.html": [], "/deplacements.html": [],
  "/stats.html": ["responsable", "admin"], "/admin.html": ["admin"] };
app.use((req, res, next) => {
  if (!(req.path in PAGES)) return next();
  const u = employeCourant(req);
  if (!u) return res.redirect("/");
  if (PAGES[req.path].length && !PAGES[req.path].includes(u.role)) return res.redirect("/profil.html");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

/* ------------------------------------------------------------------ */
/* Authentification                                                    */
/* ------------------------------------------------------------------ */
app.post("/api/login", wrap((req, res) => {
  const matricule = txt(req.body.matricule, 20).toUpperCase();
  const mdp = String(req.body.password ?? "");
  const generique = "Matricule ou mot de passe incorrect.";
  if (!matricule || !mdp) return bad(res, generique, 401);

  const e = db.prepare("SELECT * FROM employes WHERE matricule = ?").get(matricule);
  if (!e || !e.actif) { bcrypt.compareSync(mdp, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali"); return bad(res, generique, 401); }
  if (e.bloque_jusqua > Date.now()) {
    return bad(res, `Compte temporairement bloqué. Réessayez dans ${Math.ceil((e.bloque_jusqua - Date.now()) / 60000)} min.`, 429);
  }
  if (!bcrypt.compareSync(mdp, e.password_hash)) {
    const echecs = e.echecs + 1;
    const bloque = echecs >= MAX_ECHECS ? Date.now() + BLOCAGE_MS : 0;
    db.prepare("UPDATE employes SET echecs = ?, bloque_jusqua = ? WHERE matricule = ?").run(bloque ? 0 : echecs, bloque, matricule);
    journaliser(matricule, "Échec de connexion", bloque ? "Compte bloqué 15 min" : `Tentative ${echecs}/${MAX_ECHECS}`);
    return bad(res, generique, 401);
  }
  db.prepare("UPDATE employes SET echecs = 0, bloque_jusqua = 0 WHERE matricule = ?").run(matricule);
  req.session.regenerate((err) => {
    if (err) return bad(res, "Erreur de session.", 500);
    req.session.matricule = matricule;
    journaliser(matricule, "Connexion");
    res.json({ ok: true });
  });
}));

app.post("/api/logout", (req, res) => {
  const m = req.session.matricule;
  req.session.destroy(() => { if (m) journaliser(m, "Déconnexion"); res.json({ ok: true }); });
});

app.get("/api/me", auth(), wrap((req, res) => {
  const u = req.user;
  const stats = db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN statut IN ('Validée','Terminée') THEN duree_minutes END), 0) AS minutes,
      COALESCE(SUM(statut = 'En attente'),0) AS en_attente, COALESCE(SUM(statut = 'Validée'),0) AS validees, COALESCE(SUM(statut = 'Terminée'),0) AS terminees
      FROM deplacements WHERE matricule = ?`).get(u.matricule);
  const aValider = u.role === "admin"
    ? db.prepare("SELECT COUNT(*) AS n FROM deplacements WHERE statut = 'En attente'").get().n
    : u.role === "responsable"
      ? db.prepare(`SELECT COUNT(*) AS n FROM deplacements d JOIN employes e ON e.matricule = d.matricule
                    WHERE d.statut = 'En attente' AND e.service_id = ? AND d.matricule != ?`).get(u.service_id, u.matricule).n
      : 0;
  const derniers = db.prepare(`${SELECT_DEP} WHERE d.matricule = ? ORDER BY d.debut_dt DESC LIMIT 5`).all(u.matricule)
    .map((d) => avecDroits(u, d));
  res.json({ employe: publicEmploye(u), stats: { ...stats, a_valider: aValider }, derniers });
}));

app.post("/api/me/password", auth(), wrap((req, res) => {
  const { actuel, nouveau } = req.body;
  if (!bcrypt.compareSync(String(actuel ?? ""), req.user.password_hash)) return bad(res, "Mot de passe actuel incorrect.");
  if (String(nouveau ?? "").length < 8) return bad(res, "Le nouveau mot de passe doit contenir au moins 8 caractères.");
  db.prepare("UPDATE employes SET password_hash = ? WHERE matricule = ?").run(bcrypt.hashSync(String(nouveau), 10), req.user.matricule);
  journaliser(req.user.matricule, "Changement de mot de passe");
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Références                                                          */
/* ------------------------------------------------------------------ */
app.get("/api/references", auth(), wrap((req, res) => {
  res.json({
    services: db.prepare("SELECT * FROM services ORDER BY nom").all(),
    tribunaux: db.prepare("SELECT * FROM tribunaux ORDER BY type, ville").all(),
    vehicules: db.prepare("SELECT * FROM vehicules WHERE actif = 1 ORDER BY type, marque").all(),
    missions: MISSIONS,
    typesVehicule: TYPES_VEHICULE,
    typesAvecParc: TYPES_AVEC_PARC,
  });
}));

app.get("/api/vehicules/disponibles", auth(), wrap((req, res) => {
  const type = txt(req.query.type);
  const debut = valideDate(txt(req.query.date_depart, 10)) && valideHeure(txt(req.query.heure_debut, 5))
    ? dt(req.query.date_depart, req.query.heure_debut) : null;
  const fin = valideDate(txt(req.query.date_arrivee, 10)) && valideHeure(txt(req.query.heure_fin, 5))
    ? dt(req.query.date_arrivee, req.query.heure_fin) : null;
  const ignorer = parseInt(req.query.ignorer, 10) || 0;
  let liste = db.prepare("SELECT * FROM vehicules WHERE actif = 1 AND type = ? ORDER BY marque, matricule").all(type);
  if (debut && fin && fin > debut) {
    const pris = new Set(db.prepare(`SELECT DISTINCT vehicule_id FROM deplacements
      WHERE vehicule_id IS NOT NULL AND statut NOT IN ('Refusée','Annulée') AND id != ? AND debut_dt < ? AND fin_dt > ?`)
      .all(ignorer, fin, debut).map((r) => r.vehicule_id));
    liste = liste.map((v) => ({ ...v, disponible: !pris.has(v.id) }));
  } else {
    liste = liste.map((v) => ({ ...v, disponible: true }));
  }
  res.json(liste);
}));

/* ------------------------------------------------------------------ */
/* Déplacements                                                        */
/* ------------------------------------------------------------------ */
app.get("/api/deplacements", auth(), wrap((req, res) => {
  const u = req.user;
  const where = [], p = {};
  if (u.role === "agent") { where.push("d.matricule = @me"); p.me = u.matricule; }
  else if (u.role === "responsable") { where.push("(e.service_id = @sid OR d.matricule = @me)"); p.sid = u.service_id; p.me = u.matricule; }
  if (req.query.statut) { where.push("d.statut = @statut"); p.statut = txt(req.query.statut); }
  if (req.query.mission) { where.push("d.mission = @mission"); p.mission = txt(req.query.mission); }
  if (req.query.service_id && u.role === "admin") { where.push("e.service_id = @fs"); p.fs = parseInt(req.query.service_id, 10); }
  if (req.query.mes === "1") { where.push("d.matricule = @me2"); p.me2 = u.matricule; }
  if (req.query.q) {
    where.push(`(d.numero || ' ' || e.nom || ' ' || e.prenom || ' ' || d.matricule || ' ' || t.nom || ' ' || d.tache || ' '
                 || d.mission || ' ' || COALESCE(d.matricule_vehicule,'')) LIKE @q`);
    p.q = `%${txt(req.query.q, 60)}%`;
  }
  const sql = `${SELECT_DEP} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY d.debut_dt DESC LIMIT 1000`;
  res.json(db.prepare(sql).all(p).map((d) => avecDroits(u, d)));
}));

app.get("/api/deplacements/:id", auth(), wrap((req, res) => {
  const d = db.prepare(`${SELECT_DEP} WHERE d.id = ?`).get(parseInt(req.params.id, 10));
  if (!d || !peutVoir(req.user, d)) return bad(res, "Déplacement introuvable.", 404);
  res.json(avecDroits(req.user, d));
}));

app.post("/api/deplacements", auth(), wrap((req, res) => {
  const r = lireDeplacement(req.body, req.user.matricule);
  if (r.erreur) return bad(res, r.erreur, r.code || 400);
  const d = r.d;
  const numero = prochainNumero();
  const info = db.prepare(`INSERT INTO deplacements
    (numero, matricule, tribunal_id, mission, tache, date_depart, heure_debut, date_arrivee, heure_fin, debut_dt, fin_dt,
     duree_minutes, type_vehicule, vehicule_id, marque_vehicule, matricule_vehicule)
    VALUES (@numero,@matricule,@tribunal_id,@mission,@tache,@date_depart,@heure_debut,@date_arrivee,@heure_fin,@debut_dt,@fin_dt,
     @duree_minutes,@type_vehicule,@vehicule_id,@marque_vehicule,@matricule_vehicule)`)
    .run({ ...d, numero, matricule: req.user.matricule });
  journaliser(req.user.matricule, "Création déplacement", numero);
  res.status(201).json({ id: info.lastInsertRowid, numero });
}));

app.put("/api/deplacements/:id", auth(), wrap((req, res) => {
  const id = parseInt(req.params.id, 10);
  const ex = db.prepare(`${SELECT_DEP} WHERE d.id = ?`).get(id);
  if (!ex || !peutVoir(req.user, ex)) return bad(res, "Déplacement introuvable.", 404);
  if (!droits(req.user, ex).modifier) return bad(res, "Modification impossible : seule une demande « En attente » peut être modifiée.", 403);
  const r = lireDeplacement(req.body, ex.matricule, id);
  if (r.erreur) return bad(res, r.erreur, r.code || 400);
  db.prepare(`UPDATE deplacements SET tribunal_id=@tribunal_id, mission=@mission, tache=@tache, date_depart=@date_depart,
    heure_debut=@heure_debut, date_arrivee=@date_arrivee, heure_fin=@heure_fin, debut_dt=@debut_dt, fin_dt=@fin_dt,
    duree_minutes=@duree_minutes, type_vehicule=@type_vehicule, vehicule_id=@vehicule_id, marque_vehicule=@marque_vehicule,
    matricule_vehicule=@matricule_vehicule, modifie_le=datetime('now','localtime') WHERE id=@id`).run({ ...r.d, id });
  journaliser(req.user.matricule, "Modification déplacement", ex.numero);
  res.json({ ok: true, numero: ex.numero });
}));

app.delete("/api/deplacements/:id", auth(), wrap((req, res) => {
  const ex = db.prepare(`${SELECT_DEP} WHERE d.id = ?`).get(parseInt(req.params.id, 10));
  if (!ex || !peutVoir(req.user, ex)) return bad(res, "Déplacement introuvable.", 404);
  if (!droits(req.user, ex).supprimer) return bad(res, "Suppression impossible : seule une demande « En attente » peut être supprimée.", 403);
  db.prepare("DELETE FROM deplacements WHERE id = ?").run(ex.id);
  journaliser(req.user.matricule, "Suppression déplacement", ex.numero);
  res.json({ ok: true });
}));

/* Validation / refus / terminé / annulation */
app.post("/api/deplacements/:id/statut", auth(), wrap((req, res) => {
  const ex = db.prepare(`${SELECT_DEP} WHERE d.id = ?`).get(parseInt(req.params.id, 10));
  if (!ex || !peutVoir(req.user, ex)) return bad(res, "Déplacement introuvable.", 404);
  const cible = txt(req.body.statut);
  const motif = txt(req.body.motif, 300);
  const dr = droits(req.user, ex);
  const permis = { "Validée": dr.valider, "Refusée": dr.refuser, "Terminée": dr.terminer, "Annulée": dr.annuler };
  if (!permis[cible]) return bad(res, "Changement de statut non autorisé.", 403);
  if (cible === "Refusée" && !motif) return bad(res, "Un motif de refus est obligatoire.");
  db.prepare("UPDATE deplacements SET statut = ?, motif_refus = ?, traite_par = ?, traite_le = datetime('now','localtime') WHERE id = ?")
    .run(cible, cible === "Refusée" ? motif : ex.motif_refus, req.user.matricule, ex.id);
  journaliser(req.user.matricule, `Statut → ${cible}`, ex.numero + (motif ? ` (${motif})` : ""));
  res.json({ ok: true });
  // E-mail à l'agent (validation ou refus) avec le reçu PDF : envoyé en arrière-plan
  if (cible === "Validée" || cible === "Refusée") {
    const maj = db.prepare(`${SELECT_DEP} WHERE d.id = ?`).get(ex.id);
    mail.notifierDecision(maj, req.user).catch((e) => console.error("Notification :", e.message));
  }
}));

/* ------------------------------------------------------------------ */
/* Statistiques (responsable : son service, admin : tout)              */
/* ------------------------------------------------------------------ */
app.get("/api/stats", auth("responsable", "admin"), wrap((req, res) => {
  const u = req.user;
  const w = u.role === "admin" ? "1=1" : "e.service_id = @sid";
  const p = u.role === "admin" ? {} : { sid: u.service_id };
  const base = `FROM deplacements d JOIN employes e ON e.matricule = d.matricule JOIN services s ON s.id = e.service_id
                JOIN tribunaux t ON t.id = d.tribunal_id WHERE ${w}`;
  const effectif = "d.statut IN ('Validée','Terminée')";
  res.json({
    portee: u.role === "admin" ? "Tous les services" : u.service,
    total: db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN ${effectif} THEN d.duree_minutes END),0) minutes ${base}`).get(p),
    parStatut: db.prepare(`SELECT d.statut label, COUNT(*) n ${base} GROUP BY d.statut ORDER BY n DESC`).all(p),
    parService: db.prepare(`SELECT s.nom label, COUNT(*) n ${base} GROUP BY s.nom ORDER BY n DESC`).all(p),
    parTribunal: db.prepare(`SELECT t.nom label, COUNT(*) n ${base} GROUP BY t.nom ORDER BY n DESC LIMIT 8`).all(p),
    parMission: db.prepare(`SELECT d.mission label, COUNT(*) n ${base} GROUP BY d.mission ORDER BY n DESC`).all(p),
    parMois: db.prepare(`SELECT substr(d.date_depart,1,7) label, COUNT(*) n, COALESCE(SUM(d.duree_minutes),0)/60.0 heures ${base}
                         GROUP BY label ORDER BY label DESC LIMIT 12`).all(p).reverse(),
    parAgent: db.prepare(`SELECT e.prenom || ' ' || e.nom label, COUNT(*) n, COALESCE(SUM(CASE WHEN ${effectif} THEN d.duree_minutes END),0)/60.0 heures
                          ${base} GROUP BY e.matricule ORDER BY n DESC LIMIT 8`).all(p),
  });
}));

/* ------------------------------------------------------------------ */
/* Employés                                                            */
/* ------------------------------------------------------------------ */
app.get("/api/employes", auth("responsable", "admin"), wrap((req, res) => {
  const u = req.user;
  const rows = db.prepare(`SELECT e.*, s.nom AS service FROM employes e JOIN services s ON s.id = e.service_id
    ${u.role === "admin" ? "" : "WHERE e.service_id = ?"} ORDER BY e.nom, e.prenom`).all(...(u.role === "admin" ? [] : [u.service_id]));
  res.json(rows.map(publicEmploye));
}));

app.get("/api/employes/:matricule", auth("responsable", "admin"), wrap((req, res) => {
  const e = db.prepare(`SELECT e.*, s.nom AS service FROM employes e JOIN services s ON s.id = e.service_id WHERE e.matricule = ?`)
    .get(txt(req.params.matricule, 20).toUpperCase());
  if (!e || (req.user.role === "responsable" && e.service_id !== req.user.service_id)) return bad(res, "Employé introuvable.", 404);
  const deps = db.prepare(`${SELECT_DEP} WHERE d.matricule = ? ORDER BY d.debut_dt DESC LIMIT 100`).all(e.matricule)
    .map((d) => avecDroits(req.user, d));
  res.json({ employe: publicEmploye(e), deplacements: deps });
}));

function lireEmploye(body, creation) {
  const e = {
    nom: txt(body.nom, 60), prenom: txt(body.prenom, 60), grade: txt(body.grade, 80), fonction: txt(body.fonction, 100),
    service_id: parseInt(body.service_id, 10), telephone: txt(body.telephone, 20), email: txt(body.email, 100),
    cin: txt(body.cin, 20).toUpperCase(), date_embauche: txt(body.date_embauche, 10), role: txt(body.role),
  };
  if (!e.nom || !e.prenom || !e.grade || !e.fonction) return { erreur: "Nom, prénom, grade et fonction sont obligatoires." };
  if (!db.prepare("SELECT 1 FROM services WHERE id = ?").get(e.service_id)) return { erreur: "Service invalide." };
  if (!/^[0-9+\s().-]{8,20}$/.test(e.telephone)) return { erreur: "Numéro de téléphone invalide." };
  if (e.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email)) return { erreur: "E-mail invalide." };
  if (e.date_embauche && !valideDate(e.date_embauche)) return { erreur: "Date d'embauche invalide." };
  if (!["agent", "responsable", "admin"].includes(e.role)) return { erreur: "Rôle invalide." };
  if (creation) {
    e.matricule = txt(body.matricule, 12).toUpperCase();
    if (!/^[A-Z0-9]{3,12}$/.test(e.matricule)) return { erreur: "Matricule invalide (3 à 12 lettres/chiffres)." };
    e.password = String(body.password ?? "");
    if (e.password.length < 8) return { erreur: "Le mot de passe doit contenir au moins 8 caractères." };
  }
  return { e };
}

app.post("/api/employes", auth("admin"), wrap((req, res) => {
  const r = lireEmploye(req.body, true);
  if (r.erreur) return bad(res, r.erreur);
  if (db.prepare("SELECT 1 FROM employes WHERE matricule = ?").get(r.e.matricule)) return bad(res, "Ce matricule existe déjà.", 409);
  db.prepare(`INSERT INTO employes (matricule, nom, prenom, grade, fonction, service_id, telephone, email, cin, date_embauche, role, password_hash)
    VALUES (@matricule,@nom,@prenom,@grade,@fonction,@service_id,@telephone,@email,@cin,@date_embauche,@role,@hash)`)
    .run({ ...r.e, hash: bcrypt.hashSync(r.e.password, 10) });
  journaliser(req.user.matricule, "Création employé", r.e.matricule);
  res.status(201).json({ ok: true });
}));

app.put("/api/employes/:matricule", auth("admin"), wrap((req, res) => {
  const mat = txt(req.params.matricule, 20).toUpperCase();
  if (!db.prepare("SELECT 1 FROM employes WHERE matricule = ?").get(mat)) return bad(res, "Employé introuvable.", 404);
  const r = lireEmploye(req.body, false);
  if (r.erreur) return bad(res, r.erreur);
  const actif = req.body.actif === false || req.body.actif === 0 ? 0 : 1;
  if (mat === req.user.matricule && (r.e.role !== "admin" || !actif)) return bad(res, "Vous ne pouvez pas retirer votre propre rôle administrateur ni vous désactiver.");
  db.prepare(`UPDATE employes SET nom=@nom, prenom=@prenom, grade=@grade, fonction=@fonction, service_id=@service_id,
    telephone=@telephone, email=@email, cin=@cin, date_embauche=@date_embauche, role=@role, actif=@actif WHERE matricule=@mat`)
    .run({ ...r.e, actif, mat });
  journaliser(req.user.matricule, "Modification employé", mat + (actif ? "" : " (désactivé)"));
  res.json({ ok: true });
}));

app.post("/api/employes/:matricule/mot-de-passe", auth("admin"), wrap((req, res) => {
  const mat = txt(req.params.matricule, 20).toUpperCase();
  const nouveau = String(req.body.nouveau ?? "");
  if (nouveau.length < 8) return bad(res, "Le mot de passe doit contenir au moins 8 caractères.");
  const info = db.prepare("UPDATE employes SET password_hash = ?, echecs = 0, bloque_jusqua = 0 WHERE matricule = ?")
    .run(bcrypt.hashSync(nouveau, 10), mat);
  if (!info.changes) return bad(res, "Employé introuvable.", 404);
  journaliser(req.user.matricule, "Réinitialisation mot de passe", mat);
  res.json({ ok: true });
}));

/* Tâches automatiques (rappels, relances) : état et exécution manuelle (admin) */
app.get("/api/taches", auth("admin"), wrap((req, res) => res.json(taches.etat())));
app.post("/api/taches/executer", auth("admin"), wrap(async (req, res) => {
  journaliser(req.user.matricule, "Exécution manuelle des tâches automatiques");
  res.json(await taches.executerTaches());
}));

/* E-mails : configuration, historique, test d'envoi (admin) */
app.get("/api/emails", auth("admin"), wrap((req, res) => {
  res.json({
    config: mail.configPublique(),
    emails: db.prepare("SELECT * FROM emails ORDER BY id DESC LIMIT 100").all(),
  });
}));

app.post("/api/emails/test", auth("admin"), wrap((req, res) => {
  const to = txt(req.body.to, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return bad(res, "Adresse e-mail invalide.");
  mail.envoyerEmail({
    to, sujet: "Test - Gestion des déplacements",
    texte: "Ceci est un e-mail de test envoyé depuis l'application Gestion des Déplacements Officiels. Si vous le lisez, la configuration fonctionne.",
  }).catch(() => {});
  journaliser(req.user.matricule, "E-mail de test", to);
  res.json({ ok: true });
}));

app.get("/api/journal", auth("admin"), wrap((req, res) => {
  res.json(db.prepare(`SELECT j.*, e.nom, e.prenom FROM journal j LEFT JOIN employes e ON e.matricule = j.matricule
                       ORDER BY j.id DESC LIMIT 200`).all());
}));

app.use("/api", (req, res) => bad(res, "Route inconnue.", 404));

ready.then(() => {
  initialiser();
  app.listen(PORT, () => {
    console.log(`Application disponible sur http://localhost:${PORT}`);
    taches.demarrerPlanificateur();
  });
}).catch((e) => { console.error("Impossible d'ouvrir la base de données :", e); process.exit(1); });
