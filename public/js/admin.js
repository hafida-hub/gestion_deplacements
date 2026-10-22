(async () => {
  const { employe: me } = await initPage("admin.html");
  const ref = await api("/api/references");
  let employes = [], edition = null;

  $("#e_service_id").innerHTML = ref.services.map((s) => `<option value="${s.id}">${esc(s.nom)}</option>`).join("");

  /* Onglets */
  const onglet = (emp) => {
    $("#vueEmp").hidden = !emp; $("#vueJournal").hidden = emp;
    $("#tabEmp").classList.toggle("actif", emp); $("#tabJournal").classList.toggle("actif", !emp);
    if (!emp) chargerJournal();
  };
  $("#tabEmp").onclick = () => onglet(true); $("#tabJournal").onclick = () => onglet(false);

  /* Liste des employés */
  async function charger() { employes = await api("/api/employes"); afficher(); }
  function afficher() {
    const q = $("#qEmp").value.toLowerCase();
    const l = employes.filter((e) => !q || Object.values(e).join(" ").toLowerCase().includes(q));
    $("#corpsEmp").innerHTML = l.map((e) => `<tr>
      <td><strong>${esc(e.matricule)}</strong></td><td>${esc(e.prenom)} ${esc(e.nom)}<br><small>${esc(e.email || "")}</small></td>
      <td>${esc(e.grade)}<br><small>${esc(e.fonction)}</small></td><td>${esc(e.service)}</td>
      <td><span class="role">${ROLES[e.role]}</span></td><td>${e.actif ? "Oui" : "<strong style='color:#b3261e'>Non</strong>"}</td>
      <td class="actions"><button class="petit" data-a="fiche" data-m="${e.matricule}">Fiche</button>
        <button class="petit clair" data-a="edit" data-m="${e.matricule}">Modifier</button>
        <button class="petit clair" data-a="pwd" data-m="${e.matricule}">Mot de passe</button></td></tr>`).join("");
  }
  $("#qEmp").addEventListener("input", afficher);
  $("#btnCsvEmp").addEventListener("click", () => telechargerCSV("employes.csv",
    ["Matricule", "Nom", "Prénom", "Grade", "Fonction", "Service", "Téléphone", "E-mail", "Rôle", "Actif"],
    employes.map((e) => [e.matricule, e.nom, e.prenom, e.grade, e.fonction, e.service, e.telephone, e.email, e.role, e.actif ? "Oui" : "Non"])));

  /* Formulaire employé */
  const dlg = $("#dlgEmp");
  const cles = ["nom", "prenom", "grade", "fonction", "service_id", "telephone", "email", "cin", "date_embauche", "role"];
  function ouvrir(e) {
    edition = e ? e.matricule : null;
    $("#titreEmp").textContent = e ? `Modifier ${e.prenom} ${e.nom}` : "Nouvel employé";
    $("#e_matricule").value = e ? e.matricule : ""; $("#e_matricule").readOnly = !!e;
    cles.forEach((c) => ($("#e_" + c).value = e ? (e[c] ?? "") : (c === "role" ? "agent" : "")));
    if (!e) $("#e_service_id").value = ref.services[0].id;
    $("#e_actif").value = e ? e.actif : 1;
    $("#blocPwd").hidden = !!e; $("#blocActif").hidden = !e; $("#e_password").required = !e;
    $("#erreurEmp").textContent = "";
    dlg.showModal();
  }
  $("#btnNouvelEmp").onclick = () => ouvrir(null);
  $("#btnFermerEmp").onclick = () => dlg.close();
  $("#formEmp").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const body = {}; cles.forEach((c) => (body[c] = $("#e_" + c).value));
    try {
      if (edition) { body.actif = $("#e_actif").value === "1"; await api("/api/employes/" + edition, { method: "PUT", body }); }
      else { body.matricule = $("#e_matricule").value; body.password = $("#e_password").value; await api("/api/employes", { method: "POST", body }); }
      dlg.close(); await charger();
    } catch (x) { $("#erreurEmp").textContent = x.message; }
  });

  /* Actions de ligne */
  $("#corpsEmp").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-a]"); if (!b) return;
    const e = employes.find((x) => x.matricule === b.dataset.m);
    if (b.dataset.a === "edit") return ouvrir(e);
    if (b.dataset.a === "pwd") {
      const n = prompt(`Nouveau mot de passe pour ${e.matricule} (8 caractères min.) :`);
      if (!n) return;
      try { await api(`/api/employes/${e.matricule}/mot-de-passe`, { method: "POST", body: { nouveau: n } }); alert("Mot de passe réinitialisé."); }
      catch (x) { alert(x.message); }
      return;
    }
    const f = await api("/api/employes/" + e.matricule);
    $("#ficheContenu").innerHTML = `<h3>${esc(f.employe.prenom)} ${esc(f.employe.nom)} <span class="role">${ROLES[f.employe.role]}</span></h3>
      <div class="infos">${[["Matricule", f.employe.matricule], ["Grade", f.employe.grade], ["Fonction", f.employe.fonction], ["Service", f.employe.service],
        ["Téléphone", f.employe.telephone], ["E-mail", f.employe.email || "-"], ["CIN", f.employe.cin || "-"], ["Embauche", formatDate(f.employe.date_embauche)]]
        .map(([k, v]) => `<div><span>${k}</span><strong>${esc(v)}</strong></div>`).join("")}</div>
      <h3 style="margin-top:18px">Historique des déplacements (${f.deplacements.length})</h3>
      <div class="tableau-wrap"><table><thead><tr><th>N°</th><th>Destination</th><th>Période</th><th>Durée</th><th>Statut</th></tr></thead><tbody>
      ${f.deplacements.map((d) => `<tr><td>${esc(d.numero)}</td><td>${esc(d.tribunal)}</td><td>${formatDate(d.date_depart)} ${esc(d.heure_debut)} → ${formatDate(d.date_arrivee)} ${esc(d.heure_fin)}</td>
        <td>${formatDuree(d.duree_minutes)}</td><td>${badge(d.statut)}</td></tr>`).join("") || '<tr><td colspan="5" class="vide">Aucun déplacement.</td></tr>'}</tbody></table></div>`;
    $("#dlgFiche").showModal();
  });
  $("#btnFermerFiche").onclick = () => $("#dlgFiche").close();

  async function chargerJournal() {
    const j = await api("/api/journal");
    $("#corpsJournal").innerHTML = j.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.matricule || "-")}${r.nom ? `<br><small>${esc(r.prenom)} ${esc(r.nom)}</small>` : ""}</td>
      <td>${esc(r.action)}</td><td>${esc(r.details || "")}</td></tr>`).join("");
  }
  await charger();
})();
