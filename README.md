# Page web de gestion — Écurie Roubaud

Page simple (HTML, CSS, JavaScript, bibliothèque Supabase), sans étape de construction.
Elle remplacera `public/gestion/` une fois validée.

## Fichiers

- `index.html` : la page.
- `style.css` : l'apparence (pensée pour le téléphone).
- `js/config.js` : adresse Supabase et clé **publique**. Jamais de clé `service_role` ici.
- `js/api.js` : connexion, enregistrement de l'appareil, échanges avec la base.
- `js/outils.js` : petits outils (messages, photos, comparaison de noms).
- `js/chevaux.js` : liste, fiche, ajout, modification, archivage des chevaux.
- `js/app.js` : démarrage et navigation entre les écrans.

## Comment elle parle à la base

Uniquement par les fonctions déjà utilisées par les tablettes :

- `er_device_access` : à la connexion, le navigateur s'enregistre comme appareil de l'écurie
  (accepté automatiquement avec le compte de l'écurie ; il apparaît sous « Page web · … »).
  Son identifiant et son secret sont gardés dans le navigateur.
- `er_mobile_sync` : lecture et enregistrement des chevaux, du planning et des séances.
  Chaque enregistrement indique la version connue ; si un autre appareil a modifié la même
  fiche entre-temps, la base refuse et la page le signale.

Aucune table n'est modifiée. Il faut se connecter avec le compte de l'écurie (celui des tablettes).

## Essayer sur le PC

Lancer le serveur `web-gestion` de `.claude/launch.json` (jwebserver d'Android Studio), puis ouvrir
http://localhost:8770.

## Publication (Netlify)

La page est publiée telle quelle sur Netlify : on dépose le dossier `web-gestion` entier sur
la page « Deploys » du site (glisser-déposer). Le fichier `_headers` ajoute les en-têtes de
sécurité (pas d'affichage dans une autre page, pas de cache périmé).
Dans `index.html`, une règle de sécurité (Content-Security-Policy) limite la page à ses propres
fichiers, à la bibliothèque Supabase (vérifiée par son empreinte) et à la base de l'écurie.
