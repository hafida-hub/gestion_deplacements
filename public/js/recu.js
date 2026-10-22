/* Génération du reçu PDF d'un déplacement (jsPDF) */
async function telechargerRecu(id) {
  if (!window.jspdf) { alert("Bibliothèque PDF introuvable (js/jspdf.umd.min.js)."); return; }
  const d = await api(`/api/deplacements/${id}`);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  doc.setFillColor(0, 51, 102); doc.rect(0, 0, W, 34, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text("Ministère de la Justice", W / 2, 14, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  doc.text("Gestion des Déplacements Officiels", W / 2, 22, { align: "center" });

  doc.setTextColor(0, 51, 102); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text("REÇU DE DÉPLACEMENT OFFICIEL", W / 2, 46, { align: "center" });
  doc.setFontSize(11); doc.setTextColor(60, 60, 60);
  doc.text(`N° ${d.numero}`, W / 2, 53, { align: "center" });

  const valide = ["Validée", "Terminée"].includes(d.statut);
  const traite = d.traite_par_nom ? `${d.traite_par_prenom} ${d.traite_par_nom} (${d.traite_par}) le ${formatDate(d.traite_le)}` : "-";
  const vehicule = [d.type_vehicule, d.marque_vehicule, d.matricule_vehicule].filter(Boolean).join(" - ");
  const lignes = [
    ["AGENT", null],
    ["Nom complet", `${d.prenom} ${d.nom}`], ["Matricule", d.matricule], ["Grade", d.grade], ["Fonction", d.fonction],
    ["Service", d.service], ["Téléphone", d.telephone],
    ["PÉRIODE ET HORAIRES", null],
    ["Départ", `${formatDate(d.date_depart)} à ${d.heure_debut}`],
    ["Arrivée / fin", `${formatDate(d.date_arrivee)} à ${d.heure_fin}`],
    ["Durée du travail", formatDuree(d.duree_minutes)],
    ["MISSION", null],
    ["Destination", d.tribunal], ["Type de mission", d.mission], ["Tâche", d.tache],
    ["Véhicule", vehicule],
    ["VALIDATION", null],
    ["Statut", d.statut],
  ];
  if (d.traite_par_nom) lignes.push([d.statut === "Refusée" ? "Refusé par" : "Traité par", traite]);
  if (d.statut === "Refusée" && d.motif_refus) lignes.push(["Motif du refus", d.motif_refus]);

  let y = 62; const x1 = 20, x2 = 70, lv = W - x2 - 20;
  lignes.forEach(([k, v]) => {
    if (v === null) {
      y += 2; doc.setFillColor(230, 238, 248); doc.rect(x1 - 2, y - 5, W - 36, 7, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(0, 51, 102); doc.text(k, x1, y); y += 8;
    } else {
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(90, 90, 90); doc.text(k, x1, y);
      doc.setFont("helvetica", "normal"); doc.setTextColor(20, 20, 20);
      const t = doc.splitTextToSize(String(v || "-"), lv); doc.text(t, x2, y); y += 6.3 * t.length;
    }
  });

  if (!valide) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(170, 60, 40);
    doc.text(`Attention : ce déplacement est « ${d.statut} ». Ce reçu n'est pas une autorisation de mission.`, W / 2, y + 6, { align: "center" });
  }

  y = Math.max(y + 16, 238);
  doc.setDrawColor(150); doc.setTextColor(60, 60, 60); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("Signature de l'agent", 30, y); doc.text("Cachet et signature du responsable", W - 30, y, { align: "right" });
  doc.rect(25, y + 3, 65, 24); doc.rect(W - 95, y + 3, 65, 24);

  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120, 120, 120);
  doc.text(`Document édité le ${new Date().toLocaleString("fr-FR")}`, W / 2, 287, { align: "center" });
  doc.save(`recu_${d.numero}.pdf`);
}
