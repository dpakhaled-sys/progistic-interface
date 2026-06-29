# Déploiement sur Vercel

L'app est prête pour Vercel : `server.js` (Express) tourne comme **fonction serverless**
unique (cf. `vercel.json`), les fichiers `public/` sont embarqués (`includeFiles`), et
l'authentification utilise un **jeton signé HMAC sans état** (compatible serverless).

## 1. Pré-requis
Le repo est déjà sur GitHub. Rien à builder (pas de framework, pas d'étape de build).

## 2. Importer le projet
1. https://vercel.com → **Add New… → Project**
2. Importe le dépôt `progistic-interface`
3. **Framework Preset : Other** · Build Command : *(vide)* · Output : *(vide)*

## 3. Variables d'environnement (Settings → Environment Variables)

| Variable | Valeur | Note |
|---|---|---|
| `WS_HOST` | `destockpa.systemwone.fr` | |
| `WS_PORT` | `7002` | |
| `WS_PATH` | `/` | |
| `WS_PROTOCOL` | `http` | |
| `CATALOGUE` | `AUTODATA` | |
| `ID_GARAGE` | `24668` | 24668 = DPA2 (DESTOCK PIECES AUTO) |
| `ID_CLIENT` | `24668` | (24669 = PRG / PRO-GISTIQUE) |
| `WS_LOGIN` | `poste4` | |
| `WS_PASSWORD` | *(le vrai mot de passe)* | secret |
| `APP_USER` | *(identifiant fort)* | login interface |
| `APP_PASS` | *(mot de passe FORT)* | ⚠️ obligatoire |
| `AUTH_SECRET` | *(64 hex aléatoires)* | ⚠️ voir ci-dessous |
| `MOCK` | `false` | |
| `UPSTASH_REDIS_REST_URL` | *(URL REST Upstash)* | ⚠️ historique partagé |
| `UPSTASH_REDIS_REST_TOKEN` | *(token REST Upstash)* | ⚠️ historique partagé |

> `VERCEL` est défini automatiquement par la plateforme — ne pas l'ajouter.

> **Historique partagé** : sans `UPSTASH_REDIS_REST_URL` **et** `UPSTASH_REDIS_REST_TOKEN`,
> chaque instance serverless Vercel stocke l'historique dans son propre `/tmp` — chaque
> poste ne voit alors que ses propres commandes. Crée une base **Upstash Redis** (gratuit)
> et copie les deux valeurs "REST API" dans ces variables. Pour vérifier en ligne :
> `GET /api/config` doit renvoyer `"historiqueStore":"redis"` (et non `"fichier"`).

**Générer `AUTH_SECRET`** :
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Indispensable et **fixe** : sans lui, chaque démarrage à froid régénère un secret aléatoire
et invalide tous les jetons (déconnexions intempestives).

## 4. Déployer
**Deploy**. Vercel fournit une URL `https://…vercel.app`.

## 5. Vérifications après déploiement
- Ouvre l'URL → tu dois arriver sur la **page de connexion**.
- Connecte-toi avec `APP_USER` / `APP_PASS`.
- Lance une recherche de dispo (ex. `KNECHT` / `OC978`).

### Si la dispo renvoie une erreur réseau / timeout
Le Web Service (`destockpa.systemwone.fr:7002`) est sur une **IP publique**, mais il peut
**filtrer par IP** (n'autoriser que le réseau Progistique). Dans ce cas, les serveurs Vercel
ne pourront pas l'atteindre. Demande à **System Wone** d'autoriser les IP sortantes de Vercel,
ou héberge plutôt sur une machine dont l'IP est déjà autorisée.

## ⚠️ Sécurité
Une fois en ligne, l'**API de commande est publique** (protégée par le login). Utilise un
`APP_PASS` **fort** et un `AUTH_SECRET` long. Le `WS_PASSWORD` vit dans les variables Vercel
(chiffrées), jamais dans le code.
