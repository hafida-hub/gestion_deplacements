const initSqlJs = require("sql.js");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "deplacements.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

/* ------------------------------------------------------------------ */
/* Couche SQLite (sql.js = SQLite en JavaScript pur, sans compilation) */
/* Elle imite l'API de better-sqlite3 : prepare().get / all / run      */
/* et sauvegarde automatiquement le fichier .db après chaque écriture. */
/* ------------------------------------------------------------------ */
let inner = null;
let timer = null;

function ecrire() {
  const data = inner.export();            // export() réinitialise les PRAGMA : on les réapplique
  inner.run("PRAGMA foreign_keys = ON");
  fs.writeFileSync(DB_PATH + ".tmp", Buffer.from(data));
  fs.renameSync(DB_PATH + ".tmp", DB_PATH);
}
function sauver() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; ecrire(); }, 150);
}
process.on("exit", () => { if (timer && inner) { clearTimeout(timer); ecrire(); } });
["SIGINT", "SIGTERM"].forEach((sig) => process.on(sig, () => process.exit(0)));

function lier(params) {
  if (params.length === 1 && params[0] && typeof params[0] === "object" && !Array.isArray(params[0])) {
    const o = {};
    for (const k of Object.keys(params[0])) o["@" + k] = params[0][k] === undefined ? null : params[0][k];
    return o;
  }
  return params.map((v) => (v === undefined ? null : v));
}

const db = {
  exec(sql) { inner.run(sql); sauver(); },
  prepare(sql) {
    return {
      get(...p) {
        const st = inner.prepare(sql);
        try { st.bind(lier(p)); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); }
      },
      all(...p) {
        const st = inner.prepare(sql);
        try { st.bind(lier(p)); const r = []; while (st.step()) r.push(st.getAsObject()); return r; } finally { st.free(); }
      },
      run(...p) {
        const st = inner.prepare(sql);
        try { st.bind(lier(p)); st.step(); } finally { st.free(); }
        const changes = inner.getRowsModified();
        const lastInsertRowid = inner.exec("SELECT last_insert_rowid()")[0].values[0][0];
        sauver();
        return { changes, lastInsertRowid };
      },
    };
  },
};

/* Ouverture de la base (asynchrone) : à attendre avant de démarrer le serveur */
const ready = initSqlJs().then((SQL) => {
  inner = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  inner.run("PRAGMA foreign_keys = ON");
  creerSchema();
});

function creerSchema() {
db.exec(`
CREATE TABLE IF NOT EXISTS services (
  id  INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS employes (
  matricule       TEXT PRIMARY KEY,
  nom             TEXT NOT NULL,
  prenom          TEXT NOT NULL,
  grade           TEXT NOT NULL,
  fonction        TEXT NOT NULL,
  service_id      INTEGER NOT NULL REFERENCES services(id),
  telephone       TEXT NOT NULL,
  email           TEXT,
  cin             TEXT,
  date_embauche   TEXT,
  role            TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent','responsable','admin')),
  password_hash   TEXT NOT NULL,
  actif           INTEGER NOT NULL DEFAULT 1,
  echecs          INTEGER NOT NULL DEFAULT 0,
  bloque_jusqua   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vehicules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  matricule  TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL,
  marque     TEXT NOT NULL,
  actif      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tribunaux (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nom   TEXT NOT NULL UNIQUE,
  type  TEXT NOT NULL,
  ville TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deplacements (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  numero             TEXT NOT NULL UNIQUE,
  matricule          TEXT NOT NULL REFERENCES employes(matricule),
  tribunal_id        INTEGER NOT NULL REFERENCES tribunaux(id),
  mission            TEXT NOT NULL,
  tache              TEXT NOT NULL,
  date_depart        TEXT NOT NULL,
  heure_debut        TEXT NOT NULL,
  date_arrivee       TEXT NOT NULL,
  heure_fin          TEXT NOT NULL,
  debut_dt           TEXT NOT NULL,
  fin_dt             TEXT NOT NULL,
  duree_minutes      INTEGER NOT NULL,
  type_vehicule      TEXT NOT NULL,
  vehicule_id        INTEGER REFERENCES vehicules(id),
  marque_vehicule    TEXT,
  matricule_vehicule TEXT,
  statut             TEXT NOT NULL DEFAULT 'En attente',
  motif_refus        TEXT,
  traite_par         TEXT REFERENCES employes(matricule),
  traite_le          TEXT,
  cree_le            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  modifie_le         TEXT
);
CREATE INDEX IF NOT EXISTS idx_dep_mat ON deplacements(matricule);
CREATE INDEX IF NOT EXISTS idx_dep_periode ON deplacements(debut_dt, fin_dt);

CREATE TABLE IF NOT EXISTS journal (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  date      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  matricule TEXT,
  action    TEXT NOT NULL,
  details   TEXT
);
`);
}


/* ------------------------------------------------------------------ */
/* Données de test (100 % fictives)                                    */
/* ------------------------------------------------------------------ */
const DEMO_PASSWORD = "Demo@2025";

const SERVICES = [
  "Service Juridique", "Service du Greffe", "Service des Ressources Humaines", "Service Informatique",
  "Service Administratif et Financier", "Service de l'Inspection Générale", "Service Pénitentiaire",
  "Service de la Protection Judiciaire de la Jeunesse", "Service des Affaires Internationales et de la Coopération",
  "Service de la Communication",
];

// [matricule, nom, prénom, grade, fonction, service, rôle]
const EMPLOYES = [
  ["ADM001", "Benkirane", "Hassan", "Administrateur principal", "Administrateur de l'application", "Service Informatique", "admin"],
  ["RES001", "El Fassi", "Nadia", "Administrateur 1er grade", "Chef du Service Juridique", "Service Juridique", "responsable"],
  ["RES002", "Tazi", "Karim", "Administrateur 1er grade", "Chef du Service du Greffe", "Service du Greffe", "responsable"],
  ["RES003", "Alaoui", "Salma", "Administrateur 2e grade", "Chef du Service des Ressources Humaines", "Service des Ressources Humaines", "responsable"],
  ["RES004", "Chraibi", "Omar", "Ingénieur d'État", "Chef du Service Informatique", "Service Informatique", "responsable"],
  ["RES005", "Idrissi", "Meryem", "Inspecteur général adjoint", "Chef du Service de l'Inspection Générale", "Service de l'Inspection Générale", "responsable"],
  ["AGT001", "Bennani", "Youssef", "Attaché de justice", "Juriste", "Service Juridique", "agent"],
  ["AGT002", "Lahlou", "Imane", "Rédacteur", "Rédactrice juridique", "Service Juridique", "agent"],
  ["AGT003", "Berrada", "Mehdi", "Attaché de justice", "Juriste", "Service Juridique", "agent"],
  ["AGT004", "Ouazzani", "Sara", "Greffier en chef", "Greffière", "Service du Greffe", "agent"],
  ["AGT005", "Sebti", "Anas", "Greffier", "Greffier", "Service du Greffe", "agent"],
  ["AGT006", "Fassi Fihri", "Hajar", "Secrétaire de greffe", "Secrétaire de greffe", "Service du Greffe", "agent"],
  ["AGT007", "Amrani", "Khalid", "Administrateur 3e grade", "Gestionnaire RH", "Service des Ressources Humaines", "agent"],
  ["AGT008", "Kettani", "Zineb", "Rédacteur", "Gestionnaire de paie", "Service des Ressources Humaines", "agent"],
  ["AGT009", "Zniber", "Rachid", "Technicien 1er grade", "Technicien réseaux", "Service Informatique", "agent"],
  ["AGT010", "Mansouri", "Lina", "Ingénieur d'application", "Développeuse", "Service Informatique", "agent"],
  ["AGT011", "Haddad", "Adil", "Ingénieur d'application", "Administrateur systèmes", "Service Informatique", "agent"],
  ["AGT012", "Skalli", "Ghita", "Administrateur 3e grade", "Comptable", "Service Administratif et Financier", "agent"],
  ["AGT013", "Benjelloun", "Tarik", "Rédacteur", "Gestionnaire budgétaire", "Service Administratif et Financier", "agent"],
  ["AGT014", "Cherkaoui", "Soukaina", "Inspecteur", "Inspectrice", "Service de l'Inspection Générale", "agent"],
  ["AGT015", "Lamrani", "Hamza", "Inspecteur", "Inspecteur", "Service de l'Inspection Générale", "agent"],
  ["AGT016", "Bouzidi", "Aya", "Éducateur", "Éducatrice", "Service de la Protection Judiciaire de la Jeunesse", "agent"],
  ["AGT017", "Doukkali", "Ilyas", "Assistant social", "Assistant social", "Service Pénitentiaire", "agent"],
  ["AGT018", "Slaoui", "Wafae", "Administrateur 3e grade", "Chargée de coopération", "Service des Affaires Internationales et de la Coopération", "agent"],
  ["AGT019", "Guessous", "Reda", "Rédacteur", "Chargé de communication", "Service de la Communication", "agent"],
];

const VEHICULES = [
  ["41872-A-1", "Voiture de service", "Skoda"], ["52310-B-6", "Voiture de service", "Skoda"],
  ["63415-A-1", "Voiture de service", "Volkswagen"], ["70921-D-26", "Voiture de service", "Volkswagen"],
  ["38764-A-6", "Voiture de service", "Mercedes-Benz"], ["84520-B-1", "Voiture de service", "Audi"],
  ["19643-A-6", "Voiture de service", "BYD"], ["27018-B-1", "Voiture de service", "BYD"],
  ["55307-A-1", "Voiture de service", "Peugeot"], ["60482-H-6", "Voiture de service", "Peugeot"],
  ["12098-A-6", "Bus", "Mercedes-Benz"], ["33651-A-1", "Bus", "Mercedes-Benz"],
];

function seed(opts = {}) {
  const hash = bcrypt.hashSync(opts.password || DEMO_PASSWORD, 10);
  const insServ = db.prepare("INSERT OR IGNORE INTO services (nom) VALUES (?)");
  SERVICES.forEach((s) => insServ.run(s));

  const tribunaux = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "tribunaux.json"), "utf-8"));
  const insTrib = db.prepare("INSERT OR IGNORE INTO tribunaux (nom, type, ville) VALUES (?,?,?)");
  tribunaux.forEach((t) => insTrib.run(t.nom, t.type, t.ville));

  const insVeh = db.prepare("INSERT OR IGNORE INTO vehicules (matricule, type, marque) VALUES (?,?,?)");
  VEHICULES.forEach((v) => insVeh.run(...v));

  const sid = db.prepare("SELECT id FROM services WHERE nom = ?");
  const insEmp = db.prepare(`INSERT OR IGNORE INTO employes
    (matricule, nom, prenom, grade, fonction, service_id, telephone, email, cin, date_embauche, role, password_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  EMPLOYES.forEach(([mat, nom, prenom, grade, fonction, service, role], i) => {
    const n = String(i + 1).padStart(2, "0");
    const email = `${prenom}.${nom}`.toLowerCase().normalize("NFD").replace(/[^a-z.]/g, "") + "@justice.demo";
    insEmp.run(mat, nom, prenom, grade, fonction, sid.get(service).id, `06 12 34 56 ${n}`, email,
      `AB${100000 + i * 137}`, `${2008 + (i % 14)}-0${1 + (i % 9)}-15`, role, hash);
  });
}

function initialiser() {
  const n = db.prepare("SELECT COUNT(*) AS n FROM employes").get().n;
  if (n === 0) seed();
}

function journaliser(matricule, action, details) {
  db.prepare("INSERT INTO journal (matricule, action, details) VALUES (?,?,?)").run(matricule || null, action, details || null);
}

module.exports = { db, ready, seed, initialiser, journaliser, DEMO_PASSWORD, DB_PATH };
