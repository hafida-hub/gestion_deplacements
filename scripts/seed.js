// Réinitialise la base : node scripts/seed.js
const fs = require("fs");
const path = require("path");
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "deplacements.db");
for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(DB_PATH + ext); } catch (e) {} }
console.log("Base supprimée. Elle sera recréée avec les données de test au prochain démarrage (npm start).");
