# NovaDownloader

Application React 19 + TypeScript + Tailwind CSS 4 + Framer Motion, API Express 5. Interface française inspirée de la référence, identité originale. Navigation, accueil, panneaux de téléchargement, FAQ et mentions sont disponibles en français, anglais, arabe (RTL) et turc.

## Démarrer

```sh
npm install
cp .env.example .env
npm run dev
```

Frontend : http://localhost:5173 — API : http://127.0.0.1:3001.

Prérequis serveur : Node.js 22+, **yt-dlp**, **FFmpeg et ffprobe** dans le PATH. Configurer `YT_DLP_PATH` et `FFMPEG_PATH` si nécessaire. Installer une version récente de yt-dlp et son moteur JavaScript recommandé selon sa documentation officielle : https://github.com/yt-dlp/yt-dlp#installation.

Si YouTube affiche *« Sign in to confirm you’re not a bot »*, le serveur utilise déjà des clients player sans PO Token (`android_vr`, `tv`, …). En local, ajoutez dans `.env` :

```sh
YT_DLP_COOKIES_FROM_BROWSER=chrome
```

(ou `firefox` / `safari`). Redémarrez ensuite `npm run dev`. Préférez un compte Google secondaire. Aucun cookie n’est collecté par l’extension : cette config reste côté serveur.

```sh
npm run build
npm run build:extension
npm start
npm test
```

`npm run build:extension` produit `dist-extension/` (Chrome → Extensions → Load unpacked). Détails : `extension/README.md`.

`npm start` sert `dist` et l’API sur le même domaine. Placer derrière un reverse proxy HTTPS en production. L’API écoute par défaut uniquement en local. Les tâches sont en mémoire : exécuter une seule instance ou ajouter une file persistante et un stockage partagé avant de répliquer le serveur.

## Traduction

Configurer `TRANSLATE_URL` avec un endpoint `/translate` compatible LibreTranslate et éventuellement `TRANSLATE_API_KEY`. Il doit accepter un tableau de phrases dans `q` et renvoyer un tableau `translatedText` de longueur identique. Les blocs de phrases complets sont traduits par lots ; les numéros et timecodes sont reconstruits sans modification. Cette intégration n’assure pas un contexte narratif entre plusieurs blocs. Sans service configuré, la traduction est désactivée et le téléchargement original reste disponible.

## Architecture

- `src/components` : navigation, identité et espace vidéo/audio/sous-titres.
- `src/pages` : page d’accueil, FAQ, informations.
- `src/hooks` : suivi des jobs et historique local.
- `src/services`, `src/types`, `src/utils` : API, contrats et validation partagée.
- `packages/shared` : types et helpers partagés (web + extension).
- `extension/` : extension navigateur Manifest V3 (voir `extension/README.md`).
- `api/server.ts` : endpoints, limitation de requêtes, fichiers et gestion des erreurs.
- `backend/services` : analyse, téléchargements, sous-processus et traduction SRT.

## Traitement

Les métadonnées et formats sont obtenus avec yt-dlp. Les flux vidéo seuls sont fusionnés avec l’audio automatiquement. MP4 est utilisé pour les sources MP4 ; MKV conserve les autres codecs sans réencodage coûteux. Les tailles de flux séparés excluent l’audio, ce qui est indiqué. Aucun format ni aucune métadonnée n’est inventé.

L’audio complet est converti en MP3 avec les métadonnées et la miniature lorsqu’elles sont disponibles. Le choix 320 kbps est une conversion, pas une amélioration de la source. Le résultat de la conversion est suivi via les véritables messages de yt-dlp et FFmpeg.

## Limites et sécurité

URLs normalisées vers un identifiant YouTube validé ; arguments de processus séparés, sans shell ; identifiants de formats et sous-titres issus de l’analyse serveur ; fichiers générés dans un dossier temporaire isolé ; UUID aléatoires pour les jobs. Limites : 3 jobs simultanés, vidéos de 2 heures maximum, limite de 4 Go par flux et contrôle du fichier final, traitement de 10 minutes maximum. Une limite disque système et un quota réseau restent nécessaires en production pour les flux dont la taille est inconnue. Les sorties temporaires sont supprimées après le transfert, à l’échec, ou après 15 minutes. Un arrêt brutal du processus nécessite le nettoyage des dossiers `nova-*` du répertoire temporaire système par l’exploitant. Restreindre également les sorties réseau au niveau de l’hébergement pour renforcer la défense SSRF des extracteurs tiers.

Les liens directs et vidéos privées, restreintes, supprimées ou bloquées sont traités avec des messages publics non techniques. Les journaux détaillés restent sur le serveur. Ne pas exposer publiquement avant d’avoir configuré l’exploitant, le contact, l’hébergement, la traduction et les limites système.

## Vérification

`npm test` couvre validation d’URL, noms de fichiers, parsing SRT, traduction simulée et conservation des timecodes/UTF-8. `npm run build` vérifie TypeScript et compile l’interface. Les tests avec traduction simulée ne valident pas un fournisseur réel. Les téléchargements YouTube réels exigent les exécutables et une connectivité autorisée.
