# Acrom Web Service — Interface Références & Disponibilité

Interface web qui interroge le Web Service XML Acrom / System Wone
(`webservice.acrom.pro:7000`) pour afficher le **catalogue (marques + références)**
et vérifier la **disponibilité + prix + stock** d'une pièce.

Le navigateur ne peut pas appeler le service `:7000` directement (CORS + identifiants
à protéger). Un petit backend Node fait donc le pont : il construit le XML, l'envoie
au service, parse la réponse et renvoie du JSON propre à l'interface.

```
Navigateur ──HTTP/JSON──▶ backend Node ──POST XML──▶ webservice.acrom.pro:7000
   (UI)                    (server.js)                (System Wone)
```

## Démarrage rapide

```bash
npm install
cp .env.example .env      # puis édite tes identifiants
npm start                 # http://localhost:3000
```

Par défaut `MOCK=true` : l'interface tourne avec des données factices
(issues des exemples de la doc) pour que tu voies tout fonctionner **sans accès réseau**.
Passe `MOCK=false` dans `.env` quand tu peux joindre le service.

## Configuration (`.env`)

| Variable      | Rôle                                              |
|---------------|---------------------------------------------------|
| `WS_HOST`     | hôte du service (`webservice.acrom.pro`)          |
| `WS_PORT`     | port (`7000`)                                     |
| `WS_PATH`     | chemin sur le serveur (souvent `/`)               |
| `WS_PROTOCOL` | `http` ou `https`                                 |
| `ID_GARAGE` / `ID_CLIENT` / `WS_LOGIN` | identifiants `<Entete>`  |
| `MOCK`        | `true` = démo, `false` = vrai service             |
| `PORT`        | port local de l'interface                         |

## Ce que couvre l'interface

- **Disponibilité** — marque + référence + quantité → statut (Dispo / Rupture /
  Inconnu / Qté insuffisante / Rupture commande autorisée), stock réel et grille
  de prix (achat brut, vente brut/net HT, net TTC, remise).
- **Catalogue** — liste des marques (filtre MCODE) → les X premières références de
  la marque, avec bouton « Voir dispo » qui bascule sur l'onglet disponibilité.
- **Bandeau d'état** — vérifie l'accès (`Typedde=ACCES`) au chargement.

Endpoints REST exposés par le backend (utiles si tu veux brancher autre chose) :
`GET /api/acces`, `GET /api/marques?filtre=OUI|NON`,
`GET /api/references?marque=X&quantite=N`, `POST /api/dispo`.
Ajoute `?debug=1` pour recevoir le XML brut dans la réponse (mise au point du parsing).

## ⚠️ Point à valider côté transport

La doc donne les **corps XML** mais pas le détail du transport sur le port 7000.
Le backend suppose un **POST HTTP** du XML (`Content-Type: text/xml`) sur `WS_PATH`.
Si à la première connexion réelle tu obtiens une erreur :

1. lance une requête avec `?debug=1` pour voir la réponse brute,
2. ajuste si besoin `WS_PATH`, `WS_PROTOCOL`, ou la méthode dans
   `callWebService()` (server.js). Tout le transport est isolé dans cette
   fonction, le reste n'a pas à changer.

Si le service est un endpoint TCP brut (et non HTTP), il faut remplacer
`callWebService()` par une connexion `net.Socket` — préviens-moi, je l'adapte.
