# Rapport de tests — Phase 1 (18/11/2026)

Branche : `phase1-messagerie-participants`. Environnement : Node.js, PostgreSQL 16 local, base de test `school_manager_pro_test`.

## 1. Résultats exacts

| Suite | Commande | Résultat |
|---|---|---|
| Unitaires | `npm test` | 25 réussis, 0 échec |
| Intégration (API réelle, base de test) | `TEST_DATABASE_URL=… npm run test:integration` | 90 réussis, 0 échec |
| Migrations | rejeu 001 → 029 sur base vide, à chaque exécution de la suite d'intégration | OK (29 fichiers) |
| Recalcul du suivi Excel | `recalc.py` | 209 formules, 0 erreur |

Lors de la première exécution : 78 réussis, 5 échecs. Les 5 échecs venaient de tests écrits avant les décisions de Phase 1. Ils ont été corrigés, sans affaiblir les contrôles :

1. **Messagerie, autre établissement** : attendu 422 → 404 (conversation traitée comme inexistante, décision D3).
2. **Bulletin** : les notes de test étaient créées en « saisie » et n'entraient plus au bulletin. Elles sont désormais validées avant calcul ; un contrôle vérifie qu'une note en saisie est exclue (§4.5).
3. **Périodes scolaires** : même cause que le point 2.
4. **Messages, enseignant non participant** : l'enseignant est d'abord refusé (404), puis ajouté comme participant par l'administrateur.
5. **Export CSV des paiements, enseignant** : aucun accès par défaut (décision D1, option B), ouverture par l'administrateur puis retrait vérifiés.

## 2. Tests ajoutés (Phase 1)

Bloc « Phase 1 : cycle des notes, corrections, périodes, rôle gérant, participants » (7 tests) et une assertion dans le portail parent :

- création forcée en « saisie », validation, annulation, transitions interdites ;
- correction : motif obligatoire, note hors barème refusée, une seule demande en attente, approbation par l'administrateur, rejet sans effet sur la note ;
- le demandeur ne peut jamais décider de sa propre demande ;
- une note non validée ne peut pas être corrigée ;
- clôture réservée à l'administrateur ; notes verrouillées dans une période clôturée ; suppression refusée ; réouverture avec motif ;
- rôle gérant : réouverture autorisée, paiements, RH et clôture refusés ;
- messagerie : retrait d'un participant, accès coupé immédiatement, lecture marquée par le participant seulement ;
- portail parent : une note en saisie n'apparaît pas, une note validée apparaît.

## 3. Vérifications complémentaires (18/11/2026)

- **Sauvegarde et restauration** : `scripts/backup.js` puis `scripts/restore.js` sur la base de test, restauration dans une base vide. Comptes de lignes identiques sur users, students, grades, conversations, academic_periods, grade_corrections, role_permissions (0 ligne).
- **Parcours navigateur** (Playwright, Chromium, serveur réel) :
  - administrateur : tous les modules d'accès aux paiements, RH, messages, paramètres sont affichés ; aucune erreur JavaScript ;
  - enseignant : paiements et RH absents du menu ;
  - gérant : paiements et RH absents ; section Paramètres → Périodes avec « Rouvrir » sur période clôturée ; section Utilisateurs absente.
  - Mobile 390 px : aucun débordement horizontal (scrollWidth = clientWidth).
- **Correctif trouvé pendant ce parcours** : la section « Utilisateurs » s'affichait au gérant avec un bouton « Ajouter » qui échouait (l'API réserve /api/users à l'administrateur). Section retirée et gestionnaires désactivés pour les non-administrateurs (`frontend/app.js`).

- **Recette navigateur Phase 1** (`tests/browser/recette-phase1.js`) : 18/18 vérifications. Enseignant : demande de correction puis retrait à l'écran (contrôlé côté serveur). Administrateur : validation d'une note en saisie, approbation d'une correction depuis Paramètres, clôture de période, verrouillage d'une note dans la période. Gérant : réouverture ; section Utilisateurs absente. Tableau de bord chargé sans erreur pour les trois rôles.
- **Suites** après ces changements : intégration 95/95, unitaires 25/25.

## 4. Ce qui n'est pas vérifié

- Parcours navigateur : couvert pour les notes, corrections, périodes et tableaux de bord des trois rôles testés ; pas encore pour le parent, l’enseignant sur ses seules classes, ni sur mobile au-delà de la page des notes.
- Mise à niveau depuis une copie de base réelle : non exécutée.
- Rendu visuel du bulletin : contrôlé une fois sur un PDF généré avec des données fictives ; le libellé de colonne « Notes » est à clarifier.

## 5. Traitement des anomalies

Résolues dans cette livraison :
1. **Demande de correction bloquée (administrateur unique)** : retrait par l'auteur (décision D4, route `withdraw`, testé).
2. **Libellé « Notes » du bulletin** : renommé « Nb notes » (D9).
3. **Stockage des documents (§4.4)** : téléversement réel (PDF, PNG, JPEG), contrôle de la signature du fichier et de l'extension, limite de taille (`DOCUMENT_MAX_MB`, 10 Mo par défaut), nom de stockage aléatoire, dossier privé (`DOCUMENTS_DIR`), téléchargement authentifié avec en-tête `nosniff`, brouillons réservés aux rédacteurs, journalisation (D6). Testé : 95/95 en intégration, et téléversement vérifié dans le navigateur.

Restent ouvertes :
- **Documents** : pas d'analyse antivirus (service indisponible ici), pas de versions (un document ne reçoit qu'un fichier), pas de rattachement par classe pour la lecture, la liste reste visible à tous les lecteurs du module.
- **Accusés de réception et de lecture** (§4.1 point 6) : non implémentés.
- **Statuts des notes** : conservés tels quels (D5).
- **Barèmes configurables par établissement** (§5.1) : non implémentés.
- **Environnement** : le proxy exclut `registry.npmjs.org` du relais. Les commandes npm ont été lancées avec la liste `noProxy` vidée, uniquement pour ces commandes. `HTTPS_PROXY` et la vérification TLS n'ont pas été modifiés.

## 6. Commande de reproduction

```bash
su postgres -c "createdb school_manager_pro_test"   # base dont le nom finit par _test
npm ci
npm test
TEST_DATABASE_URL=postgres://USER:PASS@localhost:5432/school_manager_pro_test npm run test:integration
```

Attention : la suite d'intégration supprime et recrée le schéma `public` de la base de test.
