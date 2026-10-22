(async () => {
  const { employe: me } = await initPage("deplacements.html");
  const ref = await api("/api/references");
  let liste = [];

  $("#titreListe").textContent = { agent: "Mes déplacements", responsable: `Déplacements du ${me.service}`, admin: "Tous les déplacements" }[me.role];
  ["En attente", "Validée", "Refusée", "Terminée", "Annulée"].forEach((s) => $("#fStatut").insertAdjacentHTML("beforeend", `<option>${s}</option>`));
  ref.missions.forEach((m) => $("#fMission").insertAdjacentHTML("beforeend", `<option>${esc(m)}</option>`));
  if (me.role === "admin") {
    $("#fService").hidden = false;
    ref.services.forEach((s) => $("#fService").insertAdjacentHTML("beforeend", `<option value="${s.id}">${esc(s.nom)}</option>`));
  }
  const params = new URLSearchParams(location.search);
  if (params.get("statut")) $("#fStatut").value = params.get("statut");

  async function charger() {
    const q = new URLSearchParams({ q: $("#q").value, statut: $("#fStatut").value, mission: $("#fMission").value, service_id: $("#fService").value });
    [...q.keys()].forEach((k) => !q.get(k) && q.delete(k));
    liste = await api("/api/deplacements?" + q);
    afficher();
  }

  function actions(d) {
    const a = [`<button class="petit" data-act="recu" data-id="${d.id}">Reçu PDF</button>`];
    if (d.droits.valider) a.push(`<button class="petit ok" data-act="Validée" data-id="${d.id}">Valider</button>`);
    if (d.droits.refuser) a.push(`<button class="petit danger" data-act="Refusée" data-id="${d.id}">Refuser</button>`);
    if (d.droits.terminer) a.push(`<button class="petit ok" data-act="Terminée" data-id="${d.id}">Terminer</button>`);
    if (d.droits.modifier) a.push(`<button class="petit clair" data-act="modifier" data-id="${d.id}">Modifier</button>`);
    if (d.droits.annuler) a.push(`<button class="petit clair" data-act="Annulée" data-id="${d.id}">Annuler</button>`);
    if (d.droits.supprimer) a.push(`<button class="petit danger" data-act="supprimer" data-id="${d.id}">Supprimer</button>`);
    return a.join(" ");
  }

  function afficher() {
    $("#corps").innerHTML = liste.map((d) => `<tr>
      <td>${esc(d.numero)}</td>
      <td><strong>${esc(d.prenom)} ${esc(d.nom)}</strong><br><small>${esc(d.matricule)} · ${esc(d.grade)}<br>${esc(d.service)}</small></td>
      <td>${esc(d.tribunal)}</td>
      <td>${formatDate(d.date_depart)}<br><small>${esc(d.heure_debut)}</small></td>
      <td>${formatDate(d.date_arrivee)}<br><small>${esc(d.heure_fin)}</small></td>
      <td><strong>${formatDuree(d.duree_minutes)}</strong></td>
      <td>${esc(d.type_vehicule)}<br><small>${esc(d.marque_vehicule || "")} ${esc(d.matricule_vehicule || "")}</small></td>
      <td>${esc(d.mission)}<br><small>${esc(d.tache)}</small></td>
      <td>${badge(d.statut)}${d.motif_refus ? `<br><small>Motif : ${esc(d.motif_refus)}</small>` : ""}</td>
      <td class="actions">${actions(d)}</td></tr>`).join("");
    $("#compteur").textContent = `${liste.length} déplacement(s)`;
    $("#vide").hidden = liste.length > 0;
  }

  $("#corps").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-act]");
    if (!b) return;
    const id = b.dataset.id, act = b.dataset.act;
    try {
      if (act === "recu") return await telechargerRecu(id);
      if (act === "modifier") return (location.href = "formulaire.html?id=" + id);
      if (act === "supprimer") {
        if (!confirm("Supprimer définitivement ce déplacement ?")) return;
        await api("/api/deplacements/" + id, { method: "DELETE" });
      } else {
        let motif = "";
        if (act === "Refusée") { motif = prompt("Motif du refus (obligatoire) :"); if (!motif) return; }
        else if (act === "Annulée" && !confirm("Annuler ce déplacement ?")) return;
        await api(`/api/deplacements/${id}/statut`, { method: "POST", body: { statut: act, motif } });
      }
      await charger();
    } catch (x) { alert(x.message); }
  });

  let t; $("#q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(charger, 250); });
  ["#fStatut", "#fMission", "#fService"].forEach((s) => $(s).addEventListener("change", charger));
  $("#btnReset").addEventListener("click", () => { $("#q").value = $("#fStatut").value = $("#fMission").value = $("#fService").value = ""; charger(); });
  $("#btnCsv").addEventListener("click", () => telechargerCSV(`deplacements_${new Date().toISOString().slice(0, 10)}.csv`,
    ["N°", "Matricule", "Nom", "Prénom", "Grade", "Service", "Destination", "Mission", "Tâche", "Date départ", "Heure début", "Date fin", "Heure fin", "Durée", "Type véhicule", "Marque", "Matricule véhicule", "Statut"],
    liste.map((d) => [d.numero, d.matricule, d.nom, d.prenom, d.grade, d.service, d.tribunal, d.mission, d.tache, d.date_depart, d.heure_debut,
      d.date_arrivee, d.heure_fin, formatDuree(d.duree_minutes), d.type_vehicule, d.marque_vehicule, d.matricule_vehicule, d.statut])));

  await charger();

  // Bannière après enregistrement
  const nouveau = params.get("nouveau");
  if (nouveau) {
    history.replaceState(null, "", "deplacements.html");
    const d = liste.find((x) => String(x.id) === nouveau);
    if (d) {
      const b = $("#banniere"); b.hidden = false;
      b.innerHTML = `<span>Déplacement <strong>${esc(d.numero)}</strong> enregistré. Il est <strong>${esc(d.statut)}</strong>.</span>`;
      const btn = document.createElement("button"); btn.textContent = "Télécharger le reçu (PDF)";
      btn.addEventListener("click", () => telechargerRecu(d.id)); b.appendChild(btn);
    }
  }
})();
