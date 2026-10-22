(async () => {
  await initPage("stats.html");
  const s = await api("/api/stats");
  $("#portee").textContent = "· " + s.portee;
  $("#kpis").innerHTML = `
    <div class="kpi"><strong>${s.total.n}</strong><span>Déplacements</span></div>
    <div class="kpi"><strong>${Math.round(s.total.minutes / 60)} h</strong><span>Heures effectives (validés / terminés)</span></div>
    <div class="kpi"><strong>${(s.parStatut.find((x) => x.label === "En attente") || { n: 0 }).n}</strong><span>En attente de validation</span></div>`;
  const barres = (titre, rows, fmt = (r) => r.n) => {
    const max = Math.max(1, ...rows.map((r) => r.n));
    return `<div class="carte"><h3>${titre}</h3>${rows.map((r) => `<div class="bar-ligne"><span class="lib" title="${esc(r.label)}">${esc(r.label)}</span>
      <div class="bar-fond"><div class="bar-val" style="width:${(r.n / max) * 100}%"></div></div><strong>${fmt(r)}</strong></div>`).join("") || '<p class="vide">Aucune donnée.</p>'}</div>`;
  };
  $("#graphes").innerHTML =
    barres("Par statut", s.parStatut) + barres("Par type de mission", s.parMission) +
    barres("Par mois (date de départ)", s.parMois, (r) => r.n) +
    barres("Principales destinations", s.parTribunal) +
    barres("Par service", s.parService) +
    barres("Agents les plus actifs", s.parAgent, (r) => `${r.n}`);
})();
