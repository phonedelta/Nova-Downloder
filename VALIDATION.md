# Validation locale — 18 septembre 2026

## Contrôles exécutés

- Compilation TypeScript stricte et bundle Vite : succès.
- Six tests Node : validation des liens YouTube et refus des hôtes étrangers, noms de fichiers, SRT, caractères arabes UTF-8, traduction simulée dans les quatre langues, suppression du répertoire temporaire et du job.
- Chromium : largeurs 320, 375, 390, 430, 768, 1024, 1440 et 1920 px, état initial et résultat issu d’une analyse réelle ; aucun débordement après stabilisation de la mise en page.
- Langues FR / EN / AR / TR : contrôles à 320, 390, 768 et 1440 px, avec direction RTL en arabe.
- Onglets, thème clair/sombre, menu mobile, erreur de saisie : succès. Aucune exception JavaScript pendant ce parcours.
- API : santé 200 ; URLs non autorisées 400 ; job inconnu 404 ; traduction sans fournisseur 422.

## Traitements réels

Vidéo de contrôle : « Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film », chaîne Blender (`aqz-KE-bpKQ`).

- Analyse via `/api/analyze` : 37 formats vidéo, 10 formats audio ; interface regroupée en huit résolutions réelles.
- Téléchargement 144p via `/api/download/video` : fichier de 14 996 809 octets. ffprobe confirme les pistes H.264 et AAC.
- Extraction MP3 128 kbps via `/api/download/audio` : fichier de 10 224 441 octets. ffprobe confirme MP3, miniature MJPEG en `attached_pic`, titre, artiste « Blender » et année 2014.
- Après chaque transfert : job supprimé (404), nettoyage automatique appelé.
- Sous-titres : piste anglaise officielle de la vidéo publique `jNQXAC9IVRw`, export SRT de 416 octets avec timecodes valides. Aucune transcription n’est intégrée à l’application.
- Contrôle local indépendant de FFmpeg : fusion des pistes synthétiques, extraction MP3, métadonnées ID3, pochette et suppression des fichiers de test.

## Configuration restante

- Le fournisseur de traduction n’est pas configuré. Les tests FR / EN / AR / TR valident le contrat d’intégration, les blocs et les timecodes avec un fournisseur simulé, pas une traduction linguistique réelle.
- Les coordonnées de l’exploitant doivent être renseignées avant publication.
- L’application est lancée localement, sans déploiement public. Les limites et mesures d’exploitation sont documentées dans README.md.

Les exécutables de test sont installés dans `.tools`, exclus du suivi, avec leurs chemins dans `.env`. Utiliser les instructions du README sur une autre machine.
