(async () => {
  const { employe: me } = await initPage("admin.html");
  const ref = await api("/api/references");
  let employes = [], edition = null;

  $("#e_service_id").innerHTML = ref.services.map((s) => `<option value="${s.id}">${esc(s.nom)}</option>`).join("");

  /* Onglets */
  const vues = { emp: "#vueEmp", journal: "#vueJournal", mails: "#vueMails" };
  const tabs = { emp: "#tabEmp", journal: "#tabJournal", mails: "#tabMails" };
  const onglet = (nom) => {
    Object.keys(vues).forEach((k) => { $(vues[k]).hidden = k !== nom; $(tabs[k]).classList.toggle("actif", k === nom); });
    if (nom === "journal") chargerJournal();
    if (nom === "mails") chargerMails();
  };
  $("#tabEmp").onclick = () => onglet("emp"); $("#tabJournal").onclick = () => onglet("journal"); $("#tabMails").onclick = () => onglet("mails");

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

  /* E-mails */
  let mails = [];
  const LIBELLE_MODE = { smtp: (c) => `Mode : envoi réel via ${esc(c.host)}`, ethereal: () => "Mode : Ethereal (boîte de test, rien n'est livré : ouvrez le lien « Aperçu »)",
    simulation: () => "Mode : simulation (aucun envoi réel, les e-mails sont seulement enregistrés). Configurez le fichier .env pour envoyer de vrais e-mails." };
  const classeStatut = { "envoyé": "s-validee", "simulé": "s-attente", "échec": "s-refusee", "ignoré": "s-annulee", "en cours": "s-attente" };
  async function chargerTaches() {
    const t = await api("/api/taches");
    const c = t.reglages;
    $("#tachesInfo").innerHTML = t.actif
      ? `Vérification toutes les ${c.intervalleMin} min · Rappel à l'agent ${c.rappelHeuresAvant} h avant la mission · Relance du responsable après ${c.relanceHeures} h sans réponse · Escalade à l'administrateur après ${c.escaladeHeures} h.`
        + (t.dernier ? `<br>Dernière exécution : ${esc(new Date(t.dernier.date).toLocaleString("fr-FR"))} → ${t.dernier.rappels} rappel(s), ${t.dernier.relances} relance(s), ${t.dernier.escalades} escalade(s), ${t.dernier.erreurs} erreur(s).` : "<br>Aucune exécution depuis le démarrage du serveur.")
      : "Tâches automatiques désactivées (TACHES_AUTO=false).";
  }
  $("#btnTaches").onclick = async () => {
    const msg = $("#tachesMsg"); msg.className = "msg-ok"; msg.textContent = "Exécution…";
    try {
      const r = await api("/api/taches/executer", { method: "POST" });
      msg.textContent = r.ignore ? r.message : `Terminé : ${r.rappels} rappel(s), ${r.relances} relance(s), ${r.escalades} escalade(s), ${r.erreurs} erreur(s).`;
      await chargerTaches(); await chargerMails();
    } catch (x) { msg.className = "msg-err"; msg.textContent = x.message; }
  };

  async function chargerMails() {
    chargerTaches().catch(() => {});
    const r = await api("/api/emails");
    mails = r.emails;
    $("#mailMode").innerHTML = LIBELLE_MODE[r.config.mode](r.config) + ` · Expéditeur : ${esc(r.config.from)}`;
    $("#corpsMails").innerHTML = mails.map((m) => `<tr><td>${esc(m.date)}</td><td>${esc(m.destinataire)}</td><td>${esc(m.sujet)}</td>
      <td>${esc(m.piece_jointe || "-")}</td>
      <td><span class="badge ${classeStatut[m.statut] || ""}">${esc(m.statut)}</span>${m.erreur ? `<br><small>${esc(m.erreur)}</small>` : ""}
        ${m.apercu && /^https:\/\//.test(m.apercu) ? `<br><a href="${esc(m.apercu)}" target="_blank" rel="noopener">Aperçu</a>` : ""}</td>
      <td><button class="petit clair" data-mail="${m.id}">Voir</button></td></tr>`).join("")
      || '<tr><td colspan="6" class="vide">Aucun e-mail pour le moment. Validez ou refusez une demande pour en générer.</td></tr>';
  }
  $("#corpsMails").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-mail]"); if (!b) return;
    const m = mails.find((x) => String(x.id) === b.dataset.mail);
    $("#mailContenu").innerHTML = `<h3>${esc(m.sujet)}</h3><p class="indice">À : ${esc(m.destinataire)} · ${esc(m.date)}${m.piece_jointe ? " · Pièce jointe : " + esc(m.piece_jointe) : ""}</p>
      <pre style="white-space:pre-wrap;font-family:inherit;background:#f4f7fb;padding:12px;border-radius:8px">${esc(m.corps || "")}</pre>`;
    $("#dlgMail").showModal();
  });
  $("#btnFermerMail").onclick = () => $("#dlgMail").close();
  $("#btnMailRefresh").onclick = chargerMails;
  $("#btnMailTest").onclick = async () => {
    const msg = $("#mailMsg"); msg.className = "msg-ok"; msg.textContent = "";
    try {
      await api("/api/emails/test", { method: "POST", body: { to: $("#mailTo").value } });
      msg.textContent = "E-mail de test lancé. Actualisation dans 2 secondes…";
      setTimeout(chargerMails, 2000);
    } catch (x) { msg.className = "msg-err"; msg.textContent = x.message; }
  };

  await charger();
})();
