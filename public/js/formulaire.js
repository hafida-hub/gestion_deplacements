(async () => {
  const { employe: e } = await initPage("formulaire.html");
  const ref = await api("/api/references");
  const editId = new URLSearchParams(location.search).get("id");

  $("#infosAgent").innerHTML = [["Nom complet", `${e.prenom} ${e.nom}`], ["Matricule", e.matricule], ["Grade", e.grade],
    ["Fonction", e.fonction], ["Service", e.service], ["Téléphone", e.telephone]]
    .map(([k, v]) => `<div><span>${k}</span><strong>${esc(v)}</strong></div>`).join("");

  // Listes
  const groupes = {};
  ref.tribunaux.forEach((t) => (groupes[t.type] ||= []).push(t));
  $("#tribunal_id").insertAdjacentHTML("beforeend", Object.entries(groupes).map(([type, l]) =>
    `<optgroup label="${esc(type)}">${l.map((t) => `<option value="${t.id}">${esc(t.nom)}</option>`).join("")}</optgroup>`).join(""));
  $("#mission").insertAdjacentHTML("beforeend", ref.missions.map((m) => `<option>${esc(m)}</option>`).join(""));
  $("#type_vehicule").insertAdjacentHTML("beforeend", ref.typesVehicule.map((m) => `<option>${esc(m)}</option>`).join(""));

  const champs = ["tribunal_id", "mission", "tache", "date_depart", "heure_debut", "date_arrivee", "heure_fin",
    "type_vehicule", "marque_vehicule", "matricule_vehicule"];
  const val = (id) => $("#" + id).value;

  function majDuree() {
    const min = dureeMinutes(val("date_depart"), val("heure_debut"), val("date_arrivee"), val("heure_fin"));
    $("#duree").value = min === null ? "" : (min <= 0 ? "Invalide (fin avant début)" : formatDuree(min));
    return min;
  }

  let vehiculeSouhaite = null;
  async function majVehicules() {
    const type = val("type_vehicule");
    const parc = ref.typesAvecParc.includes(type);
    $("#blocParc").hidden = !parc;
    $("#blocMarque").hidden = $("#blocMat").hidden = parc || !type;
    $("#indiceVeh").textContent = "";
    if (!parc) return;
    const q = new URLSearchParams({ type, date_depart: val("date_depart"), heure_debut: val("heure_debut"),
      date_arrivee: val("date_arrivee"), heure_fin: val("heure_fin"), ignorer: editId || 0 });
    const liste = await api("/api/vehicules/disponibles?" + q);
    const courant = vehiculeSouhaite ?? $("#vehicule_id").value;
    $("#vehicule_id").innerHTML = `<option value="">-- Choisir --</option>` + liste.map((v) =>
      `<option value="${v.id}" ${v.disponible ? "" : "disabled"}>${esc(v.marque)} - ${esc(v.matricule)}${v.disponible ? "" : " (indisponible)"}</option>`).join("");
    if (courant) $("#vehicule_id").value = courant;
    vehiculeSouhaite = null;
    const dispo = liste.filter((v) => v.disponible).length;
    $("#indiceVeh").textContent = val("date_depart") && val("heure_debut") && val("date_arrivee") && val("heure_fin")
      ? `${dispo} véhicule(s) disponible(s) sur la période choisie.` : "Renseignez d'abord les dates et heures pour voir les disponibilités.";
  }

  ["date_depart", "heure_debut", "date_arrivee", "heure_fin"].forEach((id) =>
    $("#" + id).addEventListener("change", () => { majDuree(); majVehicules(); }));
  $("#type_vehicule").addEventListener("change", majVehicules);

  // Mode modification
  if (editId) {
    const d = await api("/api/deplacements/" + editId);
    $("#titreForm").textContent = `Modifier le déplacement ${d.numero}`;
    $("#btnEnvoyer").textContent = "Enregistrer les modifications";
    champs.forEach((c) => { if (d[c] != null) $("#" + c).value = d[c]; });
    vehiculeSouhaite = d.vehicule_id;
    majDuree();
    await majVehicules();
  }

  $("#form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("#erreur").textContent = "";
    const body = {};
    champs.forEach((c) => (body[c] = val(c)));
    body.vehicule_id = val("vehicule_id");
    $("#btnEnvoyer").disabled = true;
    try {
      const r = editId ? await api("/api/deplacements/" + editId, { method: "PUT", body })
                       : await api("/api/deplacements", { method: "POST", body });
      const id = editId || r.id;
      location.href = "deplacements.html?nouveau=" + id;
    } catch (x) {
      $("#erreur").textContent = x.message;
      $("#btnEnvoyer").disabled = false;
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
  });
})();
