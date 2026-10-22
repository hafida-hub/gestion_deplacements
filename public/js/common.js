/* Fonctions communes à toutes les pages */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(url, options = {}) {
  const opts = { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...options };
  if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.endsWith("/login")) { location.href = "/"; throw new Error("Session expirée"); }
  if (!r.ok) throw Object.assign(new Error(data.error || "Erreur"), { status: r.status });
  return data;
}

function formatDate(iso) {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function formatDuree(min) {
  if (min === null || min === undefined || isNaN(min) || min <= 0) return "-";
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
function dureeMinutes(dd, hd, da, ha) {
  if (!dd || !hd || !da || !ha) return null;
  const a = new Date(`${dd}T${hd}`), b = new Date(`${da}T${ha}`);
  return isNaN(a) || isNaN(b) ? null : Math.round((b - a) / 60000);
}
function badge(statut) {
  const cls = "s-" + String(statut || "").normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase().replace("enattente", "attente");
  return `<span class="badge ${cls}">${esc(statut)}</span>`;
}
const ROLES = { agent: "Agent", responsable: "Responsable de service", admin: "Administrateur" };

/* En-tête + menu selon le rôle. Renvoie l'employé connecté. */
async function initPage(actif) {
  const { employe, stats, derniers } = await api("/api/me");
  const liens = [["profil.html", "Mon profil"], ["formulaire.html", "Nouveau déplacement"],
    ["deplacements.html", employe.role === "agent" ? "Mes déplacements" : "Déplacements"]];
  if (employe.role !== "agent") liens.push(["stats.html", "Statistiques"]);
  if (employe.role === "admin") liens.push(["admin.html", "Administration"]);
  document.body.insertAdjacentHTML("afterbegin", `
    <header class="top"><img src="logo.png" alt="" onerror="this.style.display='none'">
      <h1>Ministère de la Justice<br><small style="font-weight:400">Gestion des Déplacements Officiels</small></h1></header>
    <nav class="menu">${liens.map(([h, t]) => `<a href="${h}" class="${h === actif ? "actif" : ""}">${t}</a>`).join("")}
      <span class="droite"><span>${esc(employe.prenom)} ${esc(employe.nom)} · <span class="role">${ROLES[employe.role]}</span></span>
      <button class="clair petit" id="btnDeconnexion">Déconnexion</button></span></nav>`);
  $("#btnDeconnexion").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); location.href = "/"; });
  return { employe, stats, derniers };
}

function telechargerCSV(nom, entetes, lignes) {
  const c = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + [entetes, ...lignes].map((l) => l.map(c).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  a.download = nom;
  a.click();
  URL.revokeObjectURL(a.href);
}
