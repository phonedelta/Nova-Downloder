# Extension navigateur NovaDownloader

Extension Manifest V3 pour télécharger vidéos, MP3 et sous-titres directement depuis YouTube, en réutilisant l’API NovaDownloader existante.

## Prérequis

1. Démarrer le backend NovaDownloader (`npm run dev` ou `npm start`).
2. Configurer l’URL API si besoin :

```sh
cp extension/.env.example extension/.env
```

Par défaut : `http://127.0.0.1:3001`.

## Build

Depuis la racine du dépôt :

```sh
npm install
npm run build:extension
```

Le dossier prêt à charger est :

```text
dist-extension/
```

## Installation Chrome / Edge / Brave

1. Ouvrir `chrome://extensions` (ou `edge://extensions` / `brave://extensions`).
2. Activer **Developer mode**.
3. Cliquer **Load unpacked** / **Charger l’extension non empaquetée**.
4. Sélectionner le dossier `dist-extension`.

## Utilisation

1. Ouvrir une vidéo YouTube (`/watch` ou `/shorts`).
2. Cliquer sur le bouton **NovaDownloader** dans la barre d’actions.
3. Choisir Vidéo / MP3 / Sous-titres, puis **Télécharger**.
4. Le fichier apparaît dans le gestionnaire de téléchargements du navigateur.

Le popup de la toolbar affiche la vidéo détectée ou un lien vers la plateforme.

## Firefox (préparation)

Le code passe par `browserApi` (`chrome` / `browser`). Une adaptation Manifest Firefox (background scripts, `browser_specific_settings`) pourra être ajoutée ensuite. Les APIs utilisées (`storage`, `downloads`, `runtime`, content scripts) sont standard.

## Architecture

```text
Content script (YouTube)
  → messages typés
Service worker
  → API NovaDownloader (/api/analyze, /download/*, /subtitles, /jobs)
  → chrome.downloads (URL fichier serveur, pas de gros blobs)
```

Types et helpers partagés : `packages/shared`.

## Paramètres

Page options : qualité vidéo/audio préférée, demander l’emplacement d’enregistrement, thème Auto/Clair/Sombre.

## Sécurité & droits

- Aucun secret backend dans l’extension.
- Rate limiting et CORS contrôlés côté serveur.
- L’utilisateur reste responsable du respect des droits d’auteur et des conditions d’utilisation.
