(async () => {
  const { employe: e, stats, derniers } = await initPage("profil.html");
  const initiales = (e.prenom[0] + e.nom[0]).toUpperCase();
  const cin = e.cin ? e.cin.slice(0, 2) + "••••" + e.cin.slice(-2) : "-";
  $("#contenu").innerHTML = `
    <div class="carte"><div class="profil">
      <div class="avatar">${esc(initiales)}</div>
      <div><h2 style="margin:0 0 4px">${esc(e.prenom)} ${esc(e.nom)}</h2>
        <div style="margin-bottom:14px"><span class="role">${ROLES[e.role]}</span></div>
        <div class="infos">
          <div><span>Matricule</span><strong>${esc(e.matricule)}</strong></div>
          <div><span>Grade</span><strong>${esc(e.grade)}</strong></div>
          <div><span>Fonction</span><strong>${esc(e.fonction)}</strong></div>
          <div><span>Service</span><strong>${esc(e.service)}</strong></div>
          <div><span>Téléphone</span><strong>${esc(e.telephone)}</strong></div>
          <div><span>E-mail</span><strong>${esc(e.email || "-")}</strong></div>
          <div><span>CIN</span><strong>${esc(cin)}</strong></div>
          <div><span>Date d'embauche</span><strong>${formatDate(e.date_embauche)}</strong></div>
        </div></div></div></div>

    <div class="kpis">
      <div class="kpi"><strong>${stats.total}</strong><span>Déplacements au total</span></div>
      <div class="kpi"><strong>${stats.en_attente}</strong><span>En attente de validation</span></div>
      <div class="kpi"><strong>${stats.validees + stats.terminees}</strong><span>Validés / terminés</span></div>
      <div class="kpi"><strong>${Math.round(stats.minutes / 60)} h</strong><span>Heures de mission effectives</span></div>
      ${e.role !== "agent" ? `<div class="kpi"><strong>${stats.a_valider}</strong><span>Demandes à valider</span></div>` : ""}
    </div>

    <div class="carte"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:center">
      <h3 style="margin:0">Mes derniers déplacements</h3>
      <span><a class="btn" href="formulaire.html">+ Nouveau déplacement</a>
      <a class="btn clair" href="deplacements.html">Tout voir</a></span></div>
      <div class="tableau-wrap" style="margin-top:12px"><table><thead><tr><th>N°</th><th>Destination</th><th>Période</th><th>Durée</th><th>Statut</th><th></th></tr></thead>
      <tbody>${derniers.map((d) => `<tr><td>${esc(d.numero)}</td><td>${esc(d.tribunal)}<br><small>${esc(d.mission)}</small></td>
        <td>${formatDate(d.date_depart)} ${esc(d.heure_debut)}<br><small>→ ${formatDate(d.date_arrivee)} ${esc(d.heure_fin)}</small></td>
        <td><strong>${formatDuree(d.duree_minutes)}</strong></td><td>${badge(d.statut)}</td>
        <td><button class="petit" data-recu="${d.id}">Reçu PDF</button></td></tr>`).join("")
        || `<tr><td colspan="6" class="vide">Aucun déplacement pour le moment.</td></tr>`}</tbody></table></div></div>

    <div class="carte"><h3>Changer mon mot de passe</h3>
      <form id="pwdForm" class="grille">
        <label class="champ">Mot de passe actuel<input type="password" id="actuel" autocomplete="current-password" required></label>
        <label class="champ">Nouveau mot de passe (8 caractères min.)<input type="password" id="nouveau" autocomplete="new-password" minlength="8" required></label>
        <div style="align-self:end"><button type="submit">Modifier</button></div>
      </form><p id="pwdMsg" class="msg-err"></p></div>`;

  $$("[data-recu]").forEach((b) => b.addEventListener("click", () => telechargerRecu(b.dataset.recu)));
  $("#pwdForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const m = $("#pwdMsg"); m.className = "msg-err"; m.textContent = "";
    try {
      await api("/api/me/password", { method: "POST", body: { actuel: $("#actuel").value, nouveau: $("#nouveau").value } });
      m.className = "msg-ok"; m.textContent = "Mot de passe modifié."; ev.target.reset();
    } catch (x) { m.textContent = x.message; }
  });
})();
