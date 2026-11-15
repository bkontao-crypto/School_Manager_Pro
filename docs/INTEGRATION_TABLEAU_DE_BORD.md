# Interface web — état d'intégration (v2.7.0)

`frontend/index.html` conserve l'identité visuelle du HTML fourni ; tout est désormais servi localement (CSP stricte, aucun CDN).

## Connecté à l'API
- Connexion (`POST /api/auth/login`), identité (`GET /api/auth/me`), déconnexion (jeton effacé).
- Tableau de bord : `GET /api/stats/dashboard` — indicateurs, graphique SVG des encaissements sur 6 mois, paiements récents, activités récentes (journal d'audit). Les chiffres sont calculés en SQL.
- Listes paginées (20 par page) et création : élèves, enseignants, classes, notes, présences, paiements, bibliothèque, cantine, transport, notifications, conversations.
- Élèves : recherche, modification, suppression (logique), dossier individuel imprimable.
- Bulletin de notes depuis le dossier de l'élève (période au choix, impression).
- Recherche globale : liste déroulante d'élèves (nom ou matricule).
- Actions rapides du tableau de bord : ouvrent le formulaire correspondant.
- Les boutons d'écriture n'apparaissent que si le rôle de l'utilisateur l'autorise (le serveur reste l'autorité).
- Superadmin : choix de l'établissement à l'ouverture (en-tête `x-tenant-id`).

- Emploi du temps (grille par classe, ajout/suppression pour les administrateurs, impression), Messages (fil), Rapports (synthèses + export CSV), Personnel (RH), Documents, Stocks.
- Paramètres : établissement, mon mot de passe, périodes scolaires, utilisateurs (administrateur).

## Non disponible
- Réinitialisation par e-mail, téléversement de fichiers (les documents gardent une référence texte).

## Hors ligne (PWA)
Le service worker met en cache la coquille de l'application (HTML, CSS, JS, polices, icônes). Les données de l'API ne sont jamais mises en cache : hors ligne, l'application s'ouvre mais les listes affichent « Impossible de charger les données ».

## Modifier l'interface
Après avoir ajouté des classes Tailwind dans `index.html` ou `app.js` : `npm run build:css`. Après toute modification des fichiers mis en cache, incrémenter `VERSION` dans `pwa/service-worker.js`.
