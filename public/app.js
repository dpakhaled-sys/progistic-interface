const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// Garde d'accès : sans jeton, on repart vers la page de connexion.
const TOKEN = sessionStorage.getItem("pg_token");
if (!TOKEN) location.replace("login.html");

function goToLogin() {
  sessionStorage.removeItem("pg_token");
  location.replace("login.html");
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: "Bearer " + (sessionStorage.getItem("pg_token") || ""),
    },
  });
  if (res.status === 401) {
    goToLogin();
    throw new Error("Session expirée");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erreur serveur");
  return data;
}

function logout() {
  fetch("/api/logout", {
    method: "POST",
    headers: { Authorization: "Bearer " + (sessionStorage.getItem("pg_token") || "") },
  }).finally(goToLogin);
}

const fmt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) + " €" : (v || "—");
};

/* ---------- Statut connexion ---------- */
async function checkStatus() {
  try {
    const cfg = await api("/api/config");
    $("#foot-mode").textContent = cfg.mock
      ? "Mode DÉMO (données factices)"
      : `LIVE → ${cfg.protocol}://${cfg.host}:${cfg.port}`;
    const acc = await api("/api/acces");
    $("#status-dot").className = "dot " + (acc.ok ? "ok" : "ko");
    $("#status-text").textContent = acc.ok
      ? `Accès OK · ${acc.client || "client " + cfg.idClient}`
      : `Accès refusé (code ${acc.code})`;
  } catch (e) {
    $("#status-dot").className = "dot ko";
    $("#status-text").textContent = "Service injoignable";
  }
}

/* ---------- Disponibilité ---------- */
$("#d-search").addEventListener("click", checkDispo);
["d-marque", "d-reference", "d-quantite"].forEach((id) =>
  $("#" + id).addEventListener("keydown", (e) => e.key === "Enter" && checkDispo())
);

async function checkDispo() {
  const marque = $("#d-marque").value.trim();
  const reference = $("#d-reference").value.trim();
  const quantite = $("#d-quantite").value || 1;
  const box = $("#dispo-results");

  if (!marque || !reference) {
    box.innerHTML = `<div class="error">Renseigne au moins la marque et la référence.</div>`;
    return;
  }

  const btn = $("#d-search");
  btn.disabled = true;
  box.innerHTML = `<div class="loading">Interrogation du service</div>`;

  try {
    const data = await api("/api/dispo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articles: [{ marque, reference, quantite }] }),
    });
    box.innerHTML = data.items.length
      ? data.items.map((it) => dispoCard(it, quantite)).join("")
      : `<div class="empty">Aucun résultat.</div>`;
    wireOrderButtons(box);
  } catch (e) {
    box.innerHTML = `<div class="error">${e.message}</div>`;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Commande (CDE) — avec confirmation explicite ---------- */
async function commande(payload) {
  return api("/api/commande", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function wireOrderButtons(box) {
  box.querySelectorAll(".btn-order").forEach((b) =>
    b.addEventListener("click", () => startOrder(b))
  );
}

// Étape 1 : dry-run (aucune commande créée) → on affiche ce qui sera envoyé.
async function startOrder(btn) {
  const { m: marque, r: reference, q: quantite } = btn.dataset;
  const zone = btn.closest(".result-card").querySelector(".rc-order");
  btn.disabled = true;
  zone.innerHTML = `<div class="loading">Préparation…</div>`;
  try {
    const dry = await commande({ articles: [{ marque, reference, quantite }] });
    const warn = dry.willCreateOrder
      ? `<b>⚠ Ceci crée une VRAIE commande</b> dans l'ERP Progistique.`
      : `Mode démo : aucune commande réelle ne sera créée.`;
    zone.innerHTML = `
      <div class="order-confirm">
        <p>${warn}</p>
        <p class="oc-line">Commander <b>${quantite} × ${marque} ${reference}</b> ?</p>
        <div class="oc-actions">
          <button class="btn-primary oc-go">Confirmer la commande</button>
          <button class="btn-ghost oc-cancel">Annuler</button>
        </div>
      </div>`;
    zone.querySelector(".oc-cancel").addEventListener("click", () => {
      zone.innerHTML = "";
      btn.disabled = false;
    });
    zone.querySelector(".oc-go").addEventListener("click", () =>
      confirmOrder(zone, { marque, reference, quantite })
    );
  } catch (e) {
    zone.innerHTML = `<div class="error">${e.message}</div>`;
    btn.disabled = false;
  }
}

// Étape 2 : envoi confirmé (confirm:true) → vraie commande.
async function confirmOrder(zone, article) {
  zone.innerHTML = `<div class="loading">Envoi de la commande…</div>`;
  try {
    const r = await commande({ articles: [article], confirm: true });
    const lignes = (r.lignes || [])
      .map(
        (l) =>
          `<li class="${l.ok ? "ok" : "ko"}">${l.marque} ${l.reference} — ${
            l.text || (l.ok ? "Ligne intégrée" : "Ligne ignorée")
          }</li>`
      )
      .join("");
    zone.innerHTML = `
      <div class="order-done ${r.ok ? "ok" : "ko"}">
        <div class="od-head">${
          r.numCDE ? `Commande créée · <b>${r.numCDE}</b>` : `Réponse : ${r.text || r.code}`
        }</div>
        <ul class="od-lines">${lignes}</ul>
      </div>`;
  } catch (e) {
    zone.innerHTML = `<div class="error">${e.message}</div>`;
  }
}

function dispoCard(it, quantite = 1) {
  const lvl = it.niveau || "unknown";
  const stockTxt = [
    it.stock !== "" && it.stock != null ? `réel : <b>${it.stock}</b>` : "",
    it.stockTheo !== "" && it.stockTheo != null && it.stockTheo !== it.stock
      ? `théo : <b>${it.stockTheo}</b>` : "",
  ].filter(Boolean).join(" · ");
  const stock = stockTxt ? `<div class="rc-stock">Stock ${stockTxt}</div>` : "";

  // Méta ERP — indispensable pour enchaîner sur la création d'un BL (BLC).
  const metaRows = [
    it.designation ? ["Désignation", it.designation] : null,
    it.codeArticle ? ["Code article", it.codeArticle] : null,
    it.idArticle ? ["IDArticle", it.idArticle] : null,
    it.ean ? ["EAN", it.ean] : null,
  ].filter(Boolean);
  const meta = metaRows.length
    ? `<div class="rc-meta">${metaRows
        .map(([k, v]) => `<div class="meta"><label>${k}</label><span>${v}</span></div>`)
        .join("")}</div>`
    : "";

  const prices = (it.prixVenteNetHT || it.prixVenteNetTTC)
    ? `<div class="rc-prices">
        <div class="price"><label>Achat brut HT</label><span class="v">${fmt(it.prixAchatBrutHT)}</span></div>
        <div class="price"><label>Vente brut HT</label><span class="v">${fmt(it.prixVenteBrutHT)}</span></div>
        <div class="price"><label>Vente net HT</label><span class="v hl">${fmt(it.prixVenteNetHT)}</span></div>
        <div class="price"><label>Vente net TTC</label><span class="v hl">${fmt(it.prixVenteNetTTC)}</span></div>
        <div class="price"><label>Remise</label><span class="v">${it.remise ? it.remise + " %" : "—"}</span></div>
      </div>` : "";
  // Bouton commande seulement si la pièce peut être commandée (dispo ou rupture autorisée).
  const orderable = lvl === "ok" || lvl === "warn";
  const orderBtn = orderable
    ? `<button class="btn-order" data-m="${it.marque}" data-r="${it.reference}" data-q="${quantite}">Commander ${quantite}</button>`
    : "";

  return `<div class="result-card ${lvl}">
    <div class="rc-id">
      <div class="rc-marque">${it.marque}</div>
      <div class="rc-ref">${it.reference}</div>
    </div>
    <div class="rc-status">
      <span class="rc-badge ${lvl}">${it.statut}</span>
      ${stock}
    </div>
    ${meta}
    ${prices}
    <div class="rc-actions">${orderBtn}</div>
    <div class="rc-order"></div>
  </div>`;
}

/* ---------- Init ---------- */
if (TOKEN) {
  const logoutBtn = $("#logout");
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  checkStatus();
}
