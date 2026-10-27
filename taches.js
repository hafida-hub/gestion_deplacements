/* Tâches automatiques exécutées périodiquement par le serveur (sans dépendance externe) :
   1) Rappel à l'agent avant une mission validée
   2) Relance du responsable quand une demande reste « En attente »
   3) Escalade à l'administrateur si la demande reste sans réponse
   Réglages (variables d'environnement, voir .env.example) :
     RAPPEL_HEURES_AVANT (24)  RELANCE_HEURES (48)  ESCALADE_HEURES (72)  TACHES_INTERVALLE_MIN (30) */
const { db, SELECT_DEP, journaliser } = require("./db");
const mail = require("./mail");

const nombre = (v, defaut) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : defaut; };
const reglages = () => ({
  rappelHeuresAvant: nombre(process.env.RAPPEL_HEURES_AVANT, 24),
  relanceHeures: nombre(process.env.RELANCE_HEURES, 48),
  escaladeHeures: nombre(process.env.ESCALADE_HEURES, 72),
  intervalleMin: Math.max(1, nombre(process.env.TACHES_INTERVALLE_MIN, 30)),
});

const p2 = (n) => String(n).padStart(2, "0");
const formatDT = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const jourSql = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

let enCours = false;
let dernier = null;

async function executerTaches(maintenant = new Date()) {
  if (enCours) return { ignore: true, message: "Une exécution est déjà en cours." };
  enCours = true;
  const r = { date: maintenant.toISOString(), rappels: 0, relances: 0, escalades: 0, erreurs: 0 };
  const cfg = reglages();
  try {
    /* 1) Rappels : missions validées qui démarrent dans moins de RAPPEL_HEURES_AVANT heures */
    const limite = new Date(maintenant.getTime() + cfg.rappelHeuresAvant * 3600 * 1000);
    const aRappeler = db.prepare(`${SELECT_DEP} WHERE d.statut = 'Validée' AND d.rappel_envoye = 0
      AND d.debut_dt > ? AND d.debut_dt <= ? ORDER BY d.debut_dt`).all(formatDT(maintenant), formatDT(limite));
    for (const d of aRappeler) {
      const quand = d.date_depart === jourSql(maintenant) ? "aujourd'hui"
        : d.date_depart === jourSql(new Date(maintenant.getTime() + 86400000)) ? "demain" : `le ${d.date_depart.split("-").reverse().join("/")}`;
      db.prepare("UPDATE deplacements SET rappel_envoye = 1 WHERE id = ?").run(d.id);   // marqué avant l'envoi : jamais de doublon
      (await mail.envoyerRappelMission(d, quand)) ? r.rappels++ : r.erreurs++;
      journaliser(null, "Tâche auto : rappel de mission", d.numero);
    }

    /* 2) Relances / escalades : demandes en attente dont le départ n'est pas encore passé */
    const enAttente = db.prepare(`${SELECT_DEP} WHERE d.statut = 'En attente' AND d.relance_niveau < 2 AND d.debut_dt > ?
      ORDER BY d.cree_le`).all(formatDT(maintenant));
    for (const d of enAttente) {
      const ageH = (maintenant - new Date(d.cree_le.replace(" ", "T"))) / 3600000;
      if (d.relance_niveau === 0 && ageH >= cfg.relanceHeures) {
        let dest = db.prepare("SELECT * FROM employes WHERE actif = 1 AND role = 'responsable' AND service_id = ? AND matricule != ?").all(d.service_id, d.matricule);
        let niveau = 1;
        if (!dest.length) {            // pas d'autre responsable (ex. demande d'un responsable) : relance directe aux administrateurs, sans 2e escalade
          dest = db.prepare("SELECT * FROM employes WHERE actif = 1 AND role = 'admin' AND matricule != ?").all(d.matricule);
          niveau = 2;
        }
        db.prepare("UPDATE deplacements SET relance_niveau = ? WHERE id = ?").run(niveau, d.id);
        for (const u of dest) (await mail.envoyerRelance(d, u, Math.floor(ageH), false)) ? r.relances++ : r.erreurs++;
        journaliser(null, "Tâche auto : relance du responsable", `${d.numero} → ${dest.map((u) => u.matricule).join(", ") || "personne"}`);
      } else if (d.relance_niveau === 1 && ageH >= cfg.escaladeHeures) {
        const resp = db.prepare("SELECT prenom, nom FROM employes WHERE actif = 1 AND role = 'responsable' AND service_id = ?").all(d.service_id)
          .map((u) => `${u.prenom} ${u.nom}`).join(", ");
        const admins = db.prepare("SELECT * FROM employes WHERE actif = 1 AND role = 'admin' AND matricule != ?").all(d.matricule);
        db.prepare("UPDATE deplacements SET relance_niveau = 2 WHERE id = ?").run(d.id);
        for (const u of admins) (await mail.envoyerRelance(d, u, Math.floor(ageH), true, resp)) ? r.escalades++ : r.erreurs++;
        journaliser(null, "Tâche auto : escalade à l'administrateur", `${d.numero} → ${admins.map((u) => u.matricule).join(", ") || "personne"}`);
      }
    }
  } catch (e) {
    console.error("Tâches automatiques :", e);
    r.erreurs++; r.erreur = e.message;
  } finally {
    enCours = false;
  }
  dernier = r;
  return r;
}

let minuteur = null;
function demarrerPlanificateur() {
  const cfg = reglages();
  if (process.env.TACHES_AUTO === "false") { console.log("Tâches automatiques désactivées (TACHES_AUTO=false)."); return; }
  setTimeout(() => executerTaches(), 8000).unref();                       // rattrapage après un redémarrage
  minuteur = setInterval(() => executerTaches(), cfg.intervalleMin * 60 * 1000);
  minuteur.unref();
  console.log(`Tâches automatiques actives (toutes les ${cfg.intervalleMin} min).`);
}

const etat = () => ({ reglages: reglages(), actif: process.env.TACHES_AUTO !== "false", dernier });

module.exports = { executerTaches, demarrerPlanificateur, etat };
