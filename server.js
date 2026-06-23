import express from "express";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

// ---------------------------------------------------------------------------
// Config (.env)
// ---------------------------------------------------------------------------
try { process.loadEnvFile(); } catch { /* pas de .env : on utilise les valeurs par défaut */ }

const CFG = {
  host: process.env.WS_HOST || "webservice.acrom.pro",
  port: Number(process.env.WS_PORT || 7000),
  wsPath: process.env.WS_PATH || "/",
  protocol: (process.env.WS_PROTOCOL || "http").toLowerCase(),
  idGarage: process.env.ID_GARAGE || "1234",
  idClient: process.env.ID_CLIENT || "1234",
  catalogue: process.env.CATALOGUE || "AUTODATA",
  login: process.env.WS_LOGIN || "test",
  password: process.env.WS_PASSWORD || "",
  port_local: Number(process.env.PORT || 3000),
  mock: String(process.env.MOCK || "true").toLowerCase() === "true",
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Outils XML
// ---------------------------------------------------------------------------
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // garder les valeurs en texte (codes "0"/"1", prix, etc.)
  trimValues: true,
});

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Recherche de clé insensible à la casse (le service mélange document/Document, etc.)
function pick(obj, ...names) {
  if (!obj || typeof obj !== "object") return undefined;
  const lower = names.map((n) => n.toLowerCase());
  for (const key of Object.keys(obj)) {
    if (lower.includes(key.toLowerCase())) return obj[key];
  }
  return undefined;
}

// Force un élément (ou son absence) en tableau
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Envoi d'une requête XML au service et récupération de la réponse brute
function callWebService(xml) {
  return new Promise((resolve, reject) => {
    const lib = CFG.protocol === "https" ? https : http;
    const req = lib.request(
      {
        host: CFG.host,
        port: CFG.port,
        path: CFG.wsPath,
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "Content-Length": Buffer.byteLength(xml),
        },
        timeout: 15000,
        // Le service renvoie des en-têtes HTTP avec des fins de ligne LF seules
        // (pas CRLF) sur certains flux (ex. LISTEMARQUES) -> on tolère.
        insecureHTTPParser: true,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Timeout du Web Service")));
    req.write(xml);
    req.end();
  });
}

// En mock : renvoie un exemple basé sur la doc, sinon appelle le vrai service
async function send(typedde, xml, mockFactory) {
  if (CFG.mock) return mockFactory();
  return callWebService(xml);
}

// ---------------------------------------------------------------------------
// Construction des requêtes XML (d'après XML_WebService_acrome.pdf)
// ---------------------------------------------------------------------------
function xmlAcces() {
  return `<document>
  <Entete>
    <idgarage>${esc(CFG.idGarage)}</idgarage>
    <idclient>${esc(CFG.idClient)}</idclient>
    <login>${esc(CFG.login)}</login>
    <password>${esc(CFG.password)}</password>
    <Typedde>ACCES</Typedde>
  </Entete>
  <Articles/>
</document>`;
}

function xmlMarques() {
  // NB : cette instance rejette toute valeur de <Filtre> ("Mot inattendu") et
  // renvoie alors 0 marque. On omet donc la balise (= toutes les marques) et on
  // applique le filtre "avec MCODE" côté backend (cf. route /api/marques).
  return `<document>
  <Entete>
    <idclient>${esc(CFG.idClient)}</idclient>
    <login>${esc(CFG.login)}</login>
    <Typedde>LISTEMARQUES</Typedde>
  </Entete>
</document>`;
}

function xmlReferences(marque, quantite) {
  return `<document>
  <Entete>
    <idclient>${esc(CFG.idClient)}</idclient>
    <login>${esc(CFG.login)}</login>
    <Typedde>LISTEREFERENCES</Typedde>
  </Entete>
  <Articles>
    <Article>
      <Marque>${esc(marque)}</Marque>
      <Quantite>${esc(quantite)}</Quantite>
    </Article>
  </Articles>
</document>`;
}

function xmlDispo(articles) {
  const lignes = articles
    .map(
      (a) => `    <Article>
      <Marque>${esc(a.marque)}</Marque>
      <Reference>${esc(a.reference)}</Reference>
      <Quantite>${esc(a.quantite || 1)}</Quantite>
    </Article>`
    )
    .join("\n");
  // Format prouvé en live (cf. test OC978/KNECHT → garage 24669, client PRG) :
  // l'authentification DISPO passe par IDGarage + Catalogue, sans login/password.
  return `<document>
  <Entete>
    <IDGarage>${esc(CFG.idGarage)}</IDGarage>
    <Catalogue>${esc(CFG.catalogue)}</Catalogue>
    <Typedde>DISPO</Typedde>
  </Entete>
  <Articles>
${lignes}
  </Articles>
</document>`;
}

// Création d'une commande (Typedde=CDE, doc page 4).
// ATTENTION : balises article en minuscules ici, et <Version>1.1</Version> obligatoire.
function xmlCommande(articles) {
  const lignes = articles
    .map(
      (a) => `    <Article>
      <marque>${esc(a.marque)}</marque>
      <reference>${esc(a.reference)}</reference>
      <quantite>${esc(a.quantite || 1)}</quantite>
    </Article>`
    )
    .join("\n");
  return `<document>
  <Entete>
    <idgarage>${esc(CFG.idGarage)}</idgarage>
    <login>${esc(CFG.login)}</login>
    <Typedde>CDE</Typedde>
    <Version>1.1</Version>
  </Entete>
  <Articles>
${lignes}
  </Articles>
</document>`;
}

// ---------------------------------------------------------------------------
// Codes de disponibilité (doc page 3)
// ---------------------------------------------------------------------------
const DISPO_LABELS = {
  0: { label: "Disponible", level: "ok" },
  1: { label: "Rupture", level: "ko" },
  2: { label: "Référence inconnue", level: "unknown" },
  3: { label: "Dispo, quantité insuffisante", level: "warn" },
  4: { label: "Rupture, commande autorisée", level: "warn" },
};
const dispoMeta = (code) =>
  DISPO_LABELS[String(code)] || { label: `Code ${code}`, level: "unknown" };

// ---------------------------------------------------------------------------
// Données de démonstration (mode MOCK) — structure identique au vrai service
// ---------------------------------------------------------------------------
function mockAcces() {
  return `<document><Result><Code>0</Code><Text>OK</Text><idclient>${CFG.idClient}</idclient><Client>DIVERS</Client></Result><Reponse><Typedde>ACCES</Typedde></Reponse></document>`;
}
function mockMarques() {
  const m = [
    ["1", "VAL", "VALEO", "Valeo SA"],
    ["2", "BOS", "BOSCH", "Robert Bosch"],
    ["3", "SKF", "SKF", "SKF Roulements"],
    ["4", "INA", "INA", "Schaeffler INA"],
    ["5", "FEB", "FEBI", "Febi Bilstein"],
  ]
    .map(
      ([n, c, ma, dgn]) =>
        `<Marque><NumMarque>${n}</NumMarque><MarqueMCODE>${c}</MarqueMCODE><Marque>${ma}</Marque><MarqueDGN>${dgn}</MarqueDGN></Marque>`
    )
    .join("");
  return `<document><Result><NbrMarques>5</NbrMarques><Filtre>NON</Filtre></Result><Reponse><Typedde>LISTEMARQUE</Typedde><Marques>${m}</Marques></Reponse></document>`;
}
function mockReferences(marque) {
  const r = [
    ["1", "598752", "VAL598752", "Pompe à eau"],
    ["2", "598408", "VAL598408", "Kit distribution"],
    ["3", "732001", "VAL732001", "Compresseur clim"],
    ["4", "436712", "VAL436712", "Embrayage complet"],
  ]
    .map(
      ([n, ref, code, dgn]) =>
        `<Reference><NumReference>${n}</NumReference><Reference>${ref}</Reference><CodeArticle>${code}</CodeArticle><Designation>${dgn}</Designation></Reference>`
    )
    .join("");
  return `<document><Result><NbrArticles>4</NbrArticles><Marque>${marque}</Marque></Result><Reponse><Typedde>LISTEREFERENCES</Typedde><References>${r}</References></Reponse></document>`;
}
function mockDispo(articles) {
  const arts = articles
    .map((a, i) => {
      // démo : 598752 dispo, le reste varie
      const code = a.reference === "598752" ? 0 : a.reference === "TEST" ? 2 : i % 2 ? 1 : 0;
      const stk = code === 0 ? 12 : 0;
      return `<Article><IDMarque>1</IDMarque><Marque>${a.marque}</Marque><CodeMarque>${a.marque}</CodeMarque><Reference>${a.reference}</Reference><ReferenceComplete>${a.reference}</ReferenceComplete><Result><Code>${code}</Code><Text>${code === 0 ? "Dispo" : "Rupture"}</Text><NumArticle>${i + 1}</NumArticle><IDArticle>${100000 + i}</IDArticle><CodeArticle>${a.marque}${a.reference}</CodeArticle><DGN>PIECE DEMO</DGN><GenCod>4009026931745</GenCod><PhraseDispo>${code === 0 ? "Disponible" : "Rupture"}</PhraseDispo><CMDRupture>0</CMDRupture><PrixPublic>92.00</PrixPublic><PrixAchatBrutHT>46.50</PrixAchatBrutHT><PrixAchatNetHT>39.52</PrixAchatNetHT><PrixVenteBrutHT>92.00</PrixVenteBrutHT><PrixVenteBrutTTC>110.40</PrixVenteBrutTTC><PrixVenteNetHT>78.20</PrixVenteNetHT><PrixVenteNetTTC>93.84</PrixVenteNetTTC><QuantiteMini>1</QuantiteMini><stockreel>${stk}</stockreel><stocktheo>${stk}</stocktheo><Remise1>15</Remise1><RemiseA1>15</RemiseA1><Designation>PIECE DEMO</Designation></Result></Article>`;
    })
    .join("");
  return `<document><Result><Code>DISPO</Code><Text>OK</Text></Result><Reponse><Typedde>DISPO</Typedde><idclient>${CFG.idClient}</idclient><Client>DIVERS</Client><NbrArticles>${articles.length}</NbrArticles><Articles>${arts}</Articles></Reponse></document>`;
}

function mockCommande(articles) {
  const arts = articles
    .map((a, i) => {
      // démo : une ligne "TEST" est refusée, le reste accepté
      const code = String(a.reference).toUpperCase() === "TEST" ? 1 : 0;
      return `<Article><Marque>${a.marque}</Marque><Reference>${a.reference}</Reference><Result><Code>${code}</Code><Text>${code === 0 ? "Ligne prise en compte" : "Erreur sur ligne"}</Text><NumArticle>${i + 1}</NumArticle></Result></Article>`;
    })
    .join("");
  return `<document><Result><Code>0</Code><Text>OK</Text></Result><Reponse><Typedde>CDE</Typedde><idgarage>${CFG.idGarage}</idgarage><Client>PRG</Client><NumCDE>DEMO (C00001)</NumCDE><NbrArticles>${articles.length}</NbrArticles><Articles>${arts}</Articles></Reponse></document>`;
}

// ---------------------------------------------------------------------------
// Parsing des réponses -> JSON propre pour le front
// ---------------------------------------------------------------------------
function parseDoc(raw) {
  const root = parser.parse(raw);
  const doc = pick(root, "document");
  if (!doc) throw new Error("Réponse XML inattendue (balise <document> absente)");
  return {
    result: pick(doc, "Result") || {},
    reponse: pick(doc, "Reponse") || {},
  };
}

function parseMarques(raw) {
  const { result, reponse } = parseDoc(raw);
  const liste = asArray(pick(pick(reponse, "Marques"), "Marque"));
  return {
    count: Number(pick(result, "NbrMarques") || liste.length),
    marques: liste.map((m) => ({
      idMarque: pick(m, "IDMarque") || "",
      num: pick(m, "NumMarque") || "",
      mcode: pick(m, "MarqueMCODE") || "",
      // Le nom interrogeable est le code marque (ex. KNECHT, NGK) ; fallbacks.
      nom: pick(m, "CodeMarque") || pick(m, "Marque") || pick(m, "MarqueDGN") || "",
      designation: pick(m, "MarqueDGN") || "",
    })),
  };
}

function parseReferences(raw) {
  const { result, reponse } = parseDoc(raw);
  const liste = asArray(pick(pick(reponse, "References"), "Reference"));
  return {
    marque: pick(result, "Marque") || "",
    count: Number(pick(result, "NbrArticles") || liste.length),
    references: liste.map((r) => ({
      num: pick(r, "NumReference") || "",
      reference: pick(r, "Reference") || "",
      codeArticle: pick(r, "CodeArticle") || "",
      designation: pick(r, "Designation") || "",
      idArticle: pick(r, "IDArticle") || "",
    })),
  };
}

function parseDispo(raw) {
  const { reponse } = parseDoc(raw);
  const liste = asArray(pick(pick(reponse, "Articles"), "Article"));
  return {
    client: pick(reponse, "Client") || "",
    nom: pick(reponse, "Nom") || "",
    dispoSurStock: pick(reponse, "DispoSurStock") || "",
    nbr: Number(pick(reponse, "NbrArticles") || liste.length),
    items: liste.map((a) => {
      const r = pick(a, "Result") || {};
      const code = pick(r, "Code");
      const meta = dispoMeta(code);
      return {
        // Identité article (niveau <Article>)
        marque: pick(a, "Marque") || "",
        codeMarque: pick(a, "CodeMarque") || "",
        idMarque: pick(a, "IDMarque") || "",
        reference: pick(a, "Reference") || "",
        referenceComplete: pick(a, "ReferenceComplete") || "",
        // Statut (niveau <Result>)
        code,
        statut: meta.label,
        niveau: meta.level,
        phraseDispo: (pick(r, "PhraseDispo") || "").trim(),
        // Clés ERP (indispensables pour BLC / COI)
        idArticle: pick(r, "IDArticle") ?? "",
        codeArticle: pick(r, "CodeArticle") ?? "",
        designation: (pick(r, "Designation") || pick(r, "DGN") || "").trim(),
        ean: pick(r, "GenCod") ?? "",
        cmdRupture: pick(r, "CMDRupture") ?? "",
        quantiteMini: pick(r, "QuantiteMini") ?? "",
        // Stock
        stock: pick(r, "stockreel") ?? "",
        stockTheo: pick(r, "stocktheo") ?? "",
        // Grille de prix
        prixPublic: pick(r, "PrixPublic") ?? "",
        prixAchatBrutHT: pick(r, "PrixAchatBrutHT") ?? "",
        prixAchatNetHT: pick(r, "PrixAchatNetHT") ?? "",
        prixVenteBrutHT: pick(r, "PrixVenteBrutHT") ?? "",
        prixVenteBrutTTC: pick(r, "PrixVenteBrutTTC") ?? "",
        prixVenteNetHT: pick(r, "PrixVenteNetHT") ?? "",
        prixVenteNetTTC: pick(r, "PrixVenteNetTTC") ?? "",
        // Remises
        remise: pick(r, "Remise1") ?? "",
        remiseA1: pick(r, "RemiseA1") ?? "",
      };
    }),
  };
}

function parseCommande(raw) {
  const { result, reponse } = parseDoc(raw);
  const liste = asArray(pick(pick(reponse, "Articles"), "Article"));
  return {
    ok: String(pick(result, "Code")) === "0",
    code: pick(result, "Code"),
    text: pick(result, "Text") || "",
    client: pick(reponse, "Client") || "",
    numCDE: pick(reponse, "NumCDE") || "",
    nbr: Number(pick(reponse, "NbrArticles") || liste.length),
    lignes: liste.map((a) => {
      const r = pick(a, "Result") || {};
      const code = pick(r, "Code");
      return {
        marque: pick(a, "Marque") || "",
        reference: pick(a, "Reference") || "",
        code,
        ok: String(code) === "0", // 0 = ligne intégrée, 1 = ligne ignorée
        text: pick(r, "Text") || "",
        numArticle: pick(r, "NumArticle") || "",
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// API REST
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const wantsDebug = (req) => req.query.debug === "1";

app.get("/api/config", (_req, res) => {
  res.json({
    mock: CFG.mock,
    host: CFG.host,
    port: CFG.port,
    protocol: CFG.protocol,
    idClient: CFG.idClient,
  });
});

app.get("/api/acces", async (req, res) => {
  try {
    const xml = xmlAcces();
    const raw = await send("ACCES", xml, mockAcces);
    const { result } = parseDoc(raw);
    const code = pick(result, "Code");
    res.json({
      ok: String(code) === "0",
      code,
      text: pick(result, "Text") || "",
      client: pick(result, "Client") || "",
      ...(wantsDebug(req) ? { raw } : {}),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get("/api/marques", async (req, res) => {
  try {
    const filtre = (req.query.filtre || "NON").toUpperCase();
    const xml = xmlMarques();
    const raw = await send("LISTEMARQUES", xml, mockMarques);
    const data = parseMarques(raw);
    // Filtre "avec MCODE" appliqué ici (le service ne gère pas le mot-clé OUI/NON).
    if (filtre === "OUI") {
      data.marques = data.marques.filter((m) => m.mcode && m.mcode.trim());
      data.count = data.marques.length;
    }
    res.json({ ...data, ...(wantsDebug(req) ? { raw } : {}) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get("/api/references", async (req, res) => {
  try {
    const marque = req.query.marque;
    if (!marque) return res.status(400).json({ error: "Paramètre 'marque' requis" });
    const quantite = req.query.quantite || 50;
    const xml = xmlReferences(marque, quantite);
    const raw = await send("LISTEREFERENCES", xml, () => mockReferences(marque));
    res.json({ ...parseReferences(raw), ...(wantsDebug(req) ? { raw } : {}) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post("/api/dispo", async (req, res) => {
  try {
    const articles = Array.isArray(req.body?.articles) ? req.body.articles : [];
    if (!articles.length)
      return res.status(400).json({ error: "Liste 'articles' vide" });
    const xml = xmlDispo(articles);
    const raw = await send("DISPO", xml, () => mockDispo(articles));
    res.json({ ...parseDispo(raw), ...(wantsDebug(req) ? { raw, request: xml } : {}) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Création de commande (CDE). Garde-fou : sans { confirm: true }, on renvoie un
// "dry-run" (le XML qui SERAIT envoyé) sans rien créer dans l'ERP.
app.post("/api/commande", async (req, res) => {
  try {
    const articles = Array.isArray(req.body?.articles) ? req.body.articles : [];
    if (!articles.length)
      return res.status(400).json({ error: "Liste 'articles' vide" });
    const xml = xmlCommande(articles);
    if (req.body?.confirm !== true) {
      return res.json({
        dryRun: true,
        willCreateOrder: !CFG.mock, // true = un envoi confirmé créera une vraie commande
        articles,
        xml,
      });
    }
    const raw = await send("CDE", xml, () => mockCommande(articles));
    res.json({
      dryRun: false,
      ...parseCommande(raw),
      ...(wantsDebug(req) ? { raw, request: xml } : {}),
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.listen(CFG.port_local, () => {
  console.log(`\n  Acrom Web Service UI`);
  console.log(`  → http://localhost:${CFG.port_local}`);
  console.log(`  Mode : ${CFG.mock ? "DÉMO (données factices)" : `LIVE → ${CFG.protocol}://${CFG.host}:${CFG.port}${CFG.wsPath}`}\n`);
});
