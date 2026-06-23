# Acrom / Progistique — Interface Web Service

Interface web qui interroge le **Web Service XML Acrom / System Wone** pour, sur une seule
page : vérifier la **disponibilité + prix + stock** d'une pièce, **passer une commande**, et
parcourir le **catalogue** (marques → références).

Le navigateur ne peut pas appeler le service directement (CORS + identifiants à protéger).
Un backend Node fait le pont : il construit le XML attendu, l'envoie au service, parse la
réponse et renvoie du JSON propre à l'interface.

```
Navigateur ──HTTP/JSON──▶ backend Node ──POST XML──▶ destockpa.systemwone.fr:7002
   (public/)               (server.js)               (System Wone)
```

---

## Démarrage rapide

```bash
npm install
cp .env.example .env      # puis renseigne tes identifiants (voir plus bas)
npm start                 # → http://localhost:3001
```

- `MOCK=true` : l'interface tourne avec des **données factices** (issues de la doc), sans
  accès réseau — pratique pour la démo et le dev front.
- `MOCK=false` : appels **réels** au Web Service.

---

## Configuration (`.env`)

> ⚠️ `.env` est **exclu du dépôt** (`.gitignore`) car il contient le mot de passe du service.
> Pars de [`.env.example`](.env.example).

| Variable | Rôle | Exemple (Progistique) |
|---|---|---|
| `WS_HOST` | hôte du service | `destockpa.systemwone.fr` |
| `WS_PORT` | port | `7002` |
| `WS_PATH` | chemin sur le serveur | `/` |
| `WS_PROTOCOL` | `http` ou `https` | `http` |
| `CATALOGUE` | catalogue interrogé dans l'`<Entete>` DISPO | `AUTODATA` |
| `ID_GARAGE` / `ID_CLIENT` | identifiants `<Entete>` (souvent identiques) | `24669` |
| `WS_LOGIN` / `WS_PASSWORD` | identifiants des flux qui en ont besoin (ACCES…) | `poste4` / *(secret)* |
| `PORT` | port local de l'interface | `3001` |
| `MOCK` | `true` = démo, `false` = vrai service | `false` |

---

## Fonctionnalités

### 1. Disponibilité (`Typedde=DISPO`)
Marque + référence + quantité → statut, **stock réel/théorique**, **grille de prix complète**
(public, achat/vente brut & net HT/TTC), remises, et les **clés ERP** : `IDArticle`,
`CodeArticle`, désignation, EAN (`GenCod`).

### 2. Commande (`Typedde=CDE`)
Bouton **« Commander »** sur les articles disponibles, avec **garde-fou** :

1. **Dry-run** (par défaut) — l'API renvoie le XML qui *serait* envoyé, **sans rien créer**.
2. **Confirmation explicite** dans l'UI (avertissement « ⚠ Ceci crée une VRAIE commande »).
3. **Envoi réel** → le service crée le document et renvoie son **`NumCDE`**.

> 🛑 En `MOCK=false`, un envoi confirmé crée une **vraie commande** dans l'ERP Progistique.

### 3. Catalogue (`LISTEMARQUES` / `LISTEREFERENCES`)
Liste des marques → 1ères références d'une marque (avec `CodeArticle`, désignation,
`IDArticle`) et bouton « Voir dispo » qui bascule sur l'onglet Disponibilité.

### Bandeau d'état (`Typedde=ACCES`)
Vérifie l'accès au chargement et affiche le client résolu (ex. `PRG` / PRO-GISTIQUE).

---

## Endpoints REST (backend)

| Méthode | Route | Description |
|---|---|---|
| `GET`  | `/api/config` | mode (mock/live), hôte, port, idClient |
| `GET`  | `/api/acces` | vérifie l'accès (`ACCES`) |
| `GET`  | `/api/marques?filtre=OUI\|NON` | liste des marques (`OUI` = uniquement avec MCODE) |
| `GET`  | `/api/references?marque=X&quantite=N` | 1ères références d'une marque |
| `POST` | `/api/dispo` | dispo + prix ; body `{ articles: [{ marque, reference, quantite }] }` |
| `POST` | `/api/commande` | crée une commande ; body `{ articles: [...], confirm: true }` |

Ajoute `?debug=1` (GET) pour recevoir le **XML brut** dans la réponse (mise au point du parsing).

**Garde-fou commande** — sans `confirm: true`, `/api/commande` renvoie un dry-run :
```jsonc
{ "dryRun": true, "willCreateOrder": true, "articles": [...], "xml": "<document>…</document>" }
```

---

## Codes de retour

**Disponibilité** (`<Result><Code>`) : `0` Disponible · `1` Rupture · `2` Référence inconnue ·
`3` Dispo mais quantité insuffisante · `4` Rupture, commande autorisée.

**Commande, par ligne** : `0` ligne intégrée au document · `1` ligne ignorée.

---

## Particularités de l'instance (terrain)

Découvertes en branchant le service réel — utiles si tu reprends le code :

- **Auth DISPO** : passe par `<IDGarage>` + `<Catalogue>` dans l'`<Entete>`, **sans**
  login/password. (Le builder DISPO suit ce format prouvé.)
- **Transport** : le service renvoie parfois des **en-têtes HTTP en LF seul** (pas CRLF) →
  Node lève `Missing expected CR after response line`. Réglé via `insecureHTTPParser: true`
  dans `callWebService()`.
- **`LISTEMARQUES`** : cette instance **rejette toute valeur de `<Filtre>`**
  (« Mot inattendu » → 0 marque). On **omet** la balise (toutes les marques) et le filtre
  « avec MCODE » est appliqué **côté backend**. Le nom interrogeable est `CodeMarque`
  (ex. `NGK`, `KNECHT`), pas une balise `<Marque>`.
- **`CDE`** : balises article en **minuscules** (`<marque>`, `<reference>`, `<quantite>`),
  `<Entete>` avec `idgarage` + `login` + `<Version>1.1</Version>` **obligatoire**. On commande
  par marque + référence + quantité (l'`IDArticle` n'est pas requis).
- **`LISTEREFERENCES`** : fonctionne tel quel (idclient + login) ; la réponse inclut `IDArticle`.

---

## Stack

Node 20+ · Express · `fast-xml-parser`. Aucune dépendance front (HTML/CSS/JS pur dans `public/`).
