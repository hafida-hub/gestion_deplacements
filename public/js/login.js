document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("erreur");
  err.textContent = "";
  try {
    const r = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ matricule: document.getElementById("matricule").value, password: document.getElementById("password").value }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = data.error || "Erreur de connexion."; return; }
    location.href = "profil.html";
  } catch (x) { err.textContent = "Serveur injoignable. Vérifiez que l'application est démarrée."; }
});
