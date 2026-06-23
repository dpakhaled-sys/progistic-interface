const form = document.getElementById("login-form");
const errBox = document.getElementById("l-error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errBox.textContent = "";
  const user = document.getElementById("l-user").value.trim();
  const pass = document.getElementById("l-pass").value;
  const btn = form.querySelector("button");
  btn.disabled = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, pass }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token) {
      sessionStorage.setItem("pg_token", data.token);
      location.replace("index.html");
    } else {
      errBox.textContent = data.error || "Échec de connexion";
      btn.disabled = false;
    }
  } catch {
    errBox.textContent = "Serveur injoignable";
    btn.disabled = false;
  }
});
