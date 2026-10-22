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
scripts/seed.js      réinitialisation de la base
public/              pages (index, profil, formulaire, deplacements, stats, admin) + js/ + css/
public/logo.png      (à ajouter) logo affiché dans les en-têtes
```

Base de données : `services`, `employes`, `vehicules`, `tribunaux`, `deplacements`, `journal`.

## Configuration (optionnelle)

Variables d'environnement : `PORT` (défaut 3000), `SESSION_SECRET` (à définir en production), `DB_PATH`.

## Limites connues (à mentionner dans le rapport)

- Pas de HTTPS ni de protection CSRF avancée : à ajouter avant tout déploiement réel.
- Sessions stockées en mémoire (perdues au redémarrage du serveur).
- Pas encore d'envoi d'e-mails ni de notifications.
- La base est un fichier unique (`data/deplacements.db`) : pensez à le sauvegarder. Pour de nombreux utilisateurs simultanés, migrer vers MySQL/PostgreSQL.
