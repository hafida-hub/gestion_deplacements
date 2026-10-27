# Gestion des déplacements officiels — Ministère de la Justice (v3)

Application web avec **backend Node.js/Express** et **base de données SQLite** (via `sql.js`, sans module natif) (employés, déplacements, véhicules, tribunaux).
Projet pédagogique : toutes les données fournies sont **fictives**.

## Installation et lancement

Prérequis : [Node.js](https://nodejs.org) version 18 ou plus (LTS recommandée). Aucune compilation ni outil supplémentaire n'est nécessaire.

```bash
npm install        # une seule fois : installe les dépendances
npm start          # lance le serveur
```

Ouvrez ensuite **http://localhost:3000** dans votre navigateur.
La base `data/deplacements.db` est créée automatiquement au premier lancement avec les données de test.
Pour tout remettre à zéro : `npm run reset-db` puis `npm start`.

## Comptes de démonstration (mot de passe : `Demo@2025`)

| Matricule | Rôle | Service |
|---|---|---|
| `ADM001` | Administrateur | Service Informatique |
| `RES001` | Responsable | Service Juridique |
| `RES002` | Responsable | Service du Greffe |
| `RES003` / `RES004` / `RES005` | Responsables | RH / Informatique / Inspection générale |
| `AGT001` … `AGT019` | Agents | différents services |

`AGT001`, `AGT002`, `AGT003` sont dans le Service Juridique (donc validés par `RES001`).

## Parcours

1. Connexion avec **matricule + mot de passe** → profil (grade, fonction, service, historique, statistiques).
2. **Nouveau déplacement** : les informations de l'agent sont préremplies ; il choisit la destination (tribunal), le type de mission, la tâche,
   les dates et **heures de début/fin** (durée calculée automatiquement, ex. 08:30 → 12:30 = 4h) et le véhicule
   (liste des véhicules **disponibles** sur la période).
3. La demande passe en **« En attente »** ; le responsable du service la **valide ou la refuse** (motif obligatoire).
4. **Reçu PDF** téléchargeable à tout moment depuis la liste ou le profil (il indique si le déplacement n'est pas encore validé).

## Rôles

| | Agent | Responsable | Administrateur |
|---|---|---|---|
| Voir ses déplacements | ✔ | ✔ | ✔ |
| Voir ceux de son service | | ✔ | ✔ (tous) |
| Modifier / supprimer sa demande | tant qu'elle est « En attente » | idem | toujours |
| Valider / refuser / terminer | | son service (pas ses propres demandes) | tous |
| Statistiques | | son service | tous |
| Gérer les employés, journal d'activité | | | ✔ |

## Règles métier

- Conflit refusé si le **même agent** ou le **même véhicule** est déjà en mission sur la période (hors demandes refusées/annulées).
- Statuts : En attente → Validée / Refusée ; Validée → Terminée ; En attente ou Validée → Annulée.
- Verrouillage du compte 15 min après 5 mots de passe erronés. Mots de passe hachés (bcrypt), minimum 8 caractères.
- Journal d'activité (connexions, créations, validations…) consultable par l'administrateur.

## Structure

```
server.js            API REST + règles métier + sécurité
db.js                schéma SQLite + données de test
mail.js              envoi des e-mails (nodemailer) + journal
taches.js            rappels, relances et escalades automatiques
recu_pdf.js          reçu PDF généré côté serveur (pièce jointe)
.env.example         modèle de configuration SMTP
scripts/seed.js      réinitialisation de la base
public/              pages (index, profil, formulaire, deplacements, stats, admin) + js/ + css/
public/logo.png      (à ajouter) logo des en-têtes
public/img/fond.jfif   (à ajouter) image de fond de la page de connexion
```

Base de données : `services`, `employes`, `vehicules`, `tribunaux`, `deplacements`, `journal`.

## E-mails automatiques (validation / refus)

Quand un responsable **valide** ou **refuse** une demande, l'agent reçoit un e-mail (destination, dates, véhicule, nom de la personne
qui a décidé, motif en cas de refus) avec le **reçu PDF en pièce jointe**.

1. Copiez `.env.example` en `.env` puis renseignez vos paramètres SMTP (Gmail avec « mot de passe d'application », ou autre).
2. Redémarrez le serveur (`npm start`).
3. Connectez-vous en `ADM001` → Administration → onglet **E-mails** : mode actif, e-mail de test, historique et contenu de chaque message.
4. Pour recevoir les e-mails de démonstration, remplacez l'adresse d'un employé par la vôtre (Administration → Employés → Modifier).

Sans `.env`, le mode **simulation** enregistre les e-mails sans les envoyer (visibles dans l'onglet E-mails).
`MAIL_MODE=ethereal` utilise une boîte de test en ligne avec un lien d'aperçu.

## Tâches automatiques (rappels et relances)

Le serveur vérifie toutes les 30 minutes (réglable) et envoie, sans intervention :

| Tâche | Condition | Destinataire |
|---|---|---|
| **Rappel de mission** | mission « Validée » qui démarre dans moins de 24 h | l'agent (reçu PDF joint) |
| **Relance** | demande « En attente » depuis plus de 48 h, départ pas encore passé | le responsable du service (à défaut, l'administrateur) |
| **Escalade** | toujours sans réponse après 72 h | l'administrateur, en citant le responsable |

Chaque rappel/relance n'est envoyé qu'**une seule fois**. Tout est visible dans Administration → E-mails (réglages, dernière exécution, historique)
et dans le journal d'activité. Le bouton **« Exécuter maintenant »** lance la vérification tout de suite.
Les délais se règlent dans `.env` (`RAPPEL_HEURES_AVANT`, `RELANCE_HEURES`, `ESCALADE_HEURES`, `TACHES_INTERVALLE_MIN`, `TACHES_AUTO=false`).

**Démonstration rapide** : mettez `RELANCE_HEURES=0` et `ESCALADE_HEURES=0` dans `.env`, redémarrez, créez une demande avec un agent,
puis cliquez sur « Exécuter maintenant » (relance du responsable), puis une 2e fois (escalade à l'administrateur).
Pour le rappel : créez une mission qui démarre demain, validez-la avec le responsable, puis « Exécuter maintenant ».

## Configuration (optionnelle)

Variables d'environnement : `PORT` (défaut 3000), `SESSION_SECRET` (à définir en production), `DB_PATH`.

## Limites connues (à mentionner dans le rapport)

- Pas de HTTPS ni de protection CSRF avancée : à ajouter avant tout déploiement réel.
- Sessions stockées en mémoire (perdues au redémarrage du serveur).
- Pas encore d'envoi d'e-mails ni de notifications.
- La base est un fichier unique (`data/deplacements.db`) : pensez à le sauvegarder. Pour de nombreux utilisateurs simultanés, migrer vers MySQL/PostgreSQL.
