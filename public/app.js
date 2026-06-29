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

// Affichage des tarifs (prix + remise). Masqué pour l'instant, sur demande.
// Repasser à true pour réafficher la grille de prix.
const SHOW_PRICES = false;

// Échappement HTML : aucune donnée (réponse du service ou saisie) n'est injectée
// brute en innerHTML -> protège contre le XSS (et donc le vol du jeton de session).
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

/* ---------- Statut connexion ---------- */
async function checkStatus() {
  try {
    const cfg = await api("/api/config");
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
["d-reference", "d-quantite"].forEach((id) =>
  $("#" + id).addEventListener("keydown", (e) => e.key === "Enter" && checkDispo())
);

async function checkDispo() {
  const reference = $("#d-reference").value.trim();
  const quantite = $("#d-quantite").value || 1;
  const box = $("#dispo-results");

  if (!reference) {
    box.innerHTML = `<div class="error">Renseigne la référence.</div>`;
    return;
  }

  const btn = $("#d-search");
  btn.disabled = true;
  box.innerHTML = `<div class="loading">Interrogation du service</div>`;

  try {
    // On interroge par référence seule : le service résout la/les marque(s).
    const data = await api("/api/dispo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articles: [{ reference, quantite }] }),
    });
    renderDispo(data.items || [], quantite, box);
  } catch (e) {
    box.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

// 0 résultat → message ; 1 marque → on affiche direct ; plusieurs → on demande la marque.
function renderDispo(items, quantite, box) {
  const found = items.filter((it) => it.niveau !== "unknown");

  if (!found.length) {
    box.innerHTML = `<div class="empty">Référence inconnue — aucune correspondance.</div>`;
    return;
  }

  if (found.length === 1) {
    box.innerHTML = dispoCard(found[0], quantite);
    wireOrderButtons(box);
    return;
  }

  // Plusieurs marques pour cette référence → sélection.
  const buttons = found
    .map((it, i) => `<button class="brand-pick" data-i="${i}">${esc(it.marque || "—")}</button>`)
    .join("");
  box.innerHTML = `
    <div class="brand-choice">
      <p>Plusieurs marques pour <b>${esc(found[0].reference)}</b> — choisis la bonne :</p>
      <div class="brand-pick-row">${buttons}</div>
    </div>
    <div id="chosen-card"></div>`;

  const chosen = box.querySelector("#chosen-card");
  box.querySelectorAll(".brand-pick").forEach((b) =>
    b.addEventListener("click", () => {
      box.querySelectorAll(".brand-pick").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      chosen.innerHTML = dispoCard(found[Number(b.dataset.i)], quantite);
      wireOrderButtons(chosen);
    })
  );
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
  const { m: marque, r: reference, q: quantite, d: designation } = btn.dataset;
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
        <p class="oc-line">Commander <b>${esc(quantite)} × ${esc(marque)} ${esc(reference)}</b> ?</p>
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
      confirmOrder(zone, { marque, reference, quantite, designation })
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
    // Historique partagé : on enregistre chaque ligne réellement intégrée.
    for (const l of r.lignes || []) {
      if (l.ok)
        await recordOrder({
          marque: l.marque || article.marque,
          reference: l.reference || article.reference,
          designation: article.designation,
          quantite: article.quantite,
          numCDE: r.numCDE || "",
        });
    }
    await refreshHistory();
    const lignes = (r.lignes || [])
      .map(
        (l) =>
          `<li class="${l.ok ? "ok" : "ko"}">${esc(l.marque)} ${esc(l.reference)} — ${esc(
            l.text || (l.ok ? "Ligne intégrée" : "Ligne ignorée")
          )}</li>`
      )
      .join("");
    zone.innerHTML = `
      <div class="order-done ${r.ok ? "ok" : "ko"}">
        <div class="od-head">${
          r.numCDE ? `Commande créée · <b>${esc(r.numCDE)}</b>` : `Réponse : ${esc(r.text || r.code)}`
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
    it.stock !== "" && it.stock != null ? `réel : <b>${esc(it.stock)}</b>` : "",
    it.stockTheo !== "" && it.stockTheo != null && it.stockTheo !== it.stock
      ? `théo : <b>${esc(it.stockTheo)}</b>` : "",
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
        .map(([k, v]) => `<div class="meta"><label>${esc(k)}</label><span>${esc(v)}</span></div>`)
        .join("")}</div>`
    : "";

  const prices = (SHOW_PRICES && (it.prixVenteNetHT || it.prixVenteNetTTC))
    ? `<div class="rc-prices">
        <div class="price"><label>Achat brut HT</label><span class="v">${esc(fmt(it.prixAchatBrutHT))}</span></div>
        <div class="price"><label>Vente brut HT</label><span class="v">${esc(fmt(it.prixVenteBrutHT))}</span></div>
        <div class="price"><label>Vente net HT</label><span class="v hl">${esc(fmt(it.prixVenteNetHT))}</span></div>
        <div class="price"><label>Vente net TTC</label><span class="v hl">${esc(fmt(it.prixVenteNetTTC))}</span></div>
        <div class="price"><label>Remise</label><span class="v">${it.remise ? esc(it.remise) + " %" : "—"}</span></div>
      </div>` : "";
  // Bouton commande seulement si la pièce peut être commandée (dispo ou rupture autorisée).
  const orderable = lvl === "ok" || lvl === "warn";
  const orderBtn = orderable
    ? `<button class="btn-order" data-m="${esc(it.marque)}" data-r="${esc(it.reference)}" data-q="${esc(quantite)}" data-d="${esc(it.designation || "")}">Commander ${esc(quantite)}</button>`
    : "";

  return `<div class="result-card ${lvl}">
    <div class="rc-id">
      <div class="rc-marque">${esc(it.marque)}</div>
      <div class="rc-ref">${esc(it.reference)}</div>
    </div>
    <div class="rc-status">
      <span class="rc-badge ${lvl}">${esc(it.statut)}</span>
      ${stock}
    </div>
    ${meta}
    ${prices}
    <div class="rc-actions">${orderBtn}</div>
    <div class="rc-order"></div>
  </div>`;
}

/* ---------- Historique des commandes (partagé, côté serveur) ---------- */
// L'historique est stocké côté serveur : tous les postes connectés voient les
// mêmes commandes (y compris celles passées par les autres utilisateurs).
let ordersCache = []; // dernière liste reçue du serveur

async function fetchOrders() {
  try {
    const data = await api("/api/historique");
    ordersCache = Array.isArray(data.orders) ? data.orders : [];
  } catch {
    /* service injoignable : on garde le cache précédent */
  }
  return ordersCache;
}

async function recordOrder(o) {
  try {
    await api("/api/historique", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reference: o.reference || "",
        designation: o.designation || "",
        marque: o.marque || "",
        quantite: Number(o.quantite) || 1,
        numCDE: o.numCDE || "",
      }),
    });
  } catch {
    /* on n'interrompt pas le flux de commande si l'enregistrement échoue */
  }
}

// Début (minuit) du jour / de la semaine (lundi) / du mois en cours.
function periodStart(period) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period === "week") {
    const day = (d.getDay() + 6) % 7; // lundi = 0 … dimanche = 6
    d.setDate(d.getDate() - day);
  } else if (period === "month") {
    d.setDate(1);
  }
  return d.getTime();
}

let histPeriod = "day";

// Récupère la liste à jour depuis le serveur, puis affiche.
async function refreshHistory() {
  await fetchOrders();
  renderHistory();
}

function renderHistory() {
  const box = $("#history-list");
  if (!box) return;
  const start = periodStart(histPeriod);
  const rows = ordersCache
    .filter((o) => o.ts >= start)
    .sort((a, b) => b.ts - a.ts);

  const countEl = $("#history-count");
  if (countEl)
    countEl.textContent = rows.length
      ? `${rows.length} ligne${rows.length > 1 ? "s" : ""}`
      : "";

  if (!rows.length) {
    box.innerHTML = `<div class="empty">Aucune commande sur cette période.</div>`;
    return;
  }

  const showDate = histPeriod !== "day";
  const head = `
    <div class="hist-row hist-head">
      <span class="hc-when">${showDate ? "Date · heure" : "Heure"}</span>
      <span class="hc-ref">Référence</span>
      <span class="hc-dgn">Désignation</span>
      <span class="hc-qty">Qté</span>
    </div>`;

  const body = rows
    .map((o) => {
      const dt = new Date(o.ts);
      const time = dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      const when = showDate
        ? `${dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} · ${time}`
        : time;
      const ref = [o.marque, o.reference].filter(Boolean).join(" ");
      return `
        <div class="hist-row">
          <span class="hc-when">${esc(when)}</span>
          <span class="hc-ref">${esc(ref)}</span>
          <span class="hc-dgn">${esc(o.designation || "—")}</span>
          <span class="hc-qty">${esc(o.quantite)}</span>
        </div>`;
    })
    .join("");

  box.innerHTML = head + body;
}

/* ---------- Init ---------- */
if (TOKEN) {
  const logoutBtn = $("#logout");
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  const brandLogo = $(".brand-logo");
  if (brandLogo) brandLogo.addEventListener("click", () => location.reload());

  // Boutons de période de l'historique (jour / semaine / mois).
  $$(".hist-tab").forEach((b) =>
    b.addEventListener("click", () => {
      $$(".hist-tab").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      histPeriod = b.dataset.period;
      renderHistory();
    })
  );
  refreshHistory();
  // Rafraîchissement régulier : chaque poste voit les commandes des autres
  // sans avoir à recharger la page.
  setInterval(refreshHistory, 30000);

  checkStatus();
}
