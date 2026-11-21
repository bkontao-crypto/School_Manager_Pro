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
- **Accusés de réception et de lecture** (§4.1 point 6) : implémentés (migration 031). Un accusé par destinataire, créé à l'envoi ; réception et lecture marquées par l'interface. L'expéditeur ne voit que des compteurs. Intégration : 99/99 ; affichage vérifié dans le navigateur.
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

## 7. Mise à jour du 19/11/2026 : barème, recette destinataire, mise à niveau

### 7.1 Barème configurable par établissement (§5.1) — À tester
- Migration `032_grading_scale.sql` (additive) : `tenants.grade_scale_max` (10 ou 20, défaut 20), trigger `grades_scale_check` qui refuse toute note au-dessus du barème, quel que soit le chemin d’écriture.
- API : `GET /api/settings/grading` (tout utilisateur connecté), `PUT /api/settings/grading` (administrateur ; valeur strictement 10 ou 20 ; 409 si une note dépasse le nouveau barème).
- Saisie et demandes de correction refusées au-dessus du barème (400). Libellés du formulaire et du tableau « Moyennes par matière » adaptés.
- Bulletins : mentions restent sur 20 (moyennes normalisées), en-tête du PDF indique le barème de l’établissement.
- Intégration : 104/104 (5 tests barème). Unitaires : 25/25. Recette Phase 1 navigateur : 18/18.
- Navigateur (vérification ponctuelle) : carte « Barème des notes » dans Paramètres, libellé « Note (sur 20) », message clair en cas de refus 409 ; aucune erreur JavaScript.

### 7.2 Recette navigateur de la messagerie côté destinataire — Réalisé et vérifié
Script : `tests/browser/recette-messagerie.js` (9/9) : l’expéditeur crée une conversation et envoie un message ; le destinataire se connecte, ouvre la conversation, le message s’affiche, les appels `receive` et `read` répondent 200 ; l’expéditeur voit « 1 lu sur 1 » ; aucune erreur JavaScript ; un utilisateur non participant ne voit aucun message (200, liste vide).

### 7.3 Mise à niveau depuis une copie de base réelle — Partiel, décision requise
Protocole : base `smp_upgrade_test` (jetable). Application de `origin/main` (migrations 001→025), création de données via l’API de la version main (8 élèves, 32 notes, une conversation avec un message) et relevé du bulletin. Puis application des migrations 026→032 de la branche et redémarrage du serveur.

Résultats :
- Aucune ligne perdue : tous les volumes sont identiques avant/après ; nouvelles tables vides (`conversation_participants` backfillée à 1, `message_receipts`, `grade_corrections`).
- Migrations 026→032 appliquées sans erreur ; trigger de barème présent ; barème = 20 par défaut.
- **Anomalie bloquante avant fusion** : les 32 notes existantes restent en `saisie` (l’ancien schéma n’avait pas de validation). Le bulletin de l’élève test passe de 4 matières (moyennes 6 à 16) à 0 matière. Le bulletin ne prend en compte que les notes `validee`.
- Le message antérieur à la mise à niveau n’a pas d’accusé (0/0) : attendu, les accusés ne sont créés qu’à l’envoi.

Options à décider par l’établissement (aucune n’a été appliquée) :
1. Valider automatiquement les notes existantes par une migration corrective, avec trace d’audit (recommandé si ces notes ont déjà servi aux bulletins).
2. Laisser les notes en `saisie` et demander une validation en masse par l’administrateur après mise à niveau.
3. Prendre en compte les notes héritées dans les bulletins par un indicateur dédié.

Tant que ce point n’est pas tranché, la branche ne doit pas être fusionnée dans `main`.

### 7.4 Reprise des notes antérieures (migration 033) — Réalisé et vérifié sur copie
Décision de l’établissement : option 1 (validation automatique des notes existantes, avec trace).
- Migration `033_backfill_validated_grades.sql` (corrective, nouvelle) : chaque note `saisie` existante passe à `validee` ; son statut d’origine est conservé dans `grades_status_backfill_033` ; une entrée d’audit par établissement (`grade.backfill_validated`, sans utilisateur, avec le nombre de notes).
- Vérifications sur la copie de base (32 notes) : 32 notes `validee`, 32 lignes de reprise, 1 entrée d’audit (count 32) ; second passage sans effet (0 reprise, 0 audit ajouté) ; bulletin de l’élève test : 4 matières, mêmes moyennes qu’avant la mise à niveau (Français 11, Histoire 6, Mathématiques 6, Physique 16).
- Retour arrière vérifié en transaction annulée : le statut d’origine `saisie` est restauré pour les 32 notes.
- Intégration sur base vide (001→033) : 104/104.
- Note : une première rédaction de la migration n’avait rien mis à jour (lecture et écriture dans la même instruction). Elle n’était ni commitée ni déployée ; elle a été corrigée et rejouée sur la copie de test, dont l’état a été remis à l’avant-033.
- Reste à faire : refaire cette mise à niveau sur une base réelle sauvegardée avant la fusion ; vérifier que l’établissement accepte que ces notes deviennent validées.

### 7.5 Répétition de mise à niveau après sauvegarde et restauration — Réalisé et vérifié (copie de test)
Protocole (19/11/2026) :
1. Base de répétition au schéma `origin/main` (001→025), peuplée comme la copie précédente (8 élèves, 32 notes, 1 message).
2. Sauvegarde avec `scripts/backup.js` de la branche (fichier `smp_rehearsal_test_2026-11-19-09-11.sql.gz`, 14,2 Ko).
3. Restauration avec `scripts/restore.js --confirm` dans une base vierge : volumes identiques à la source.
4. Application des migrations 026→033 avec `scripts/migrate.js` : 8 migrations appliquées ; relance sans effet.
5. Serveur de la branche sur la base restaurée : bulletin de l’élève test à 4 matières (moyennes 11, 6, 6, 16) ; 32 notes `validee` ; 32 statuts d’origine conservés ; 1 entrée d’audit `grade.backfill_validated` ; barème 20 ; message présent.

Limites : il s’agit d’une copie de test alimentée par l’API de la version `main`, pas d’une base de production. La mise à niveau d’une base réelle reste à faire après sauvegarde sur le serveur de l’établissement.

### 7.6 Moteur PDF refondu et bulletin redessiné — Réalisé et vérifié
- Moteur (`backend/src/utils/pdf.js`), sans nouvelle dépendance : couleurs RGB et hexadécimales, rectangles arrondis, tracés, polygones, cercles, flux compressés (FlateDecode), navigation entre pages pour les pieds de page numérotés. L’API existante est conservée : les reçus et les factures continuent de fonctionner sans modification.
- Bulletin (`backend/src/utils/reportCardPdf.js`) : bandeau de marque avec filet d’accent ; carte élève ; quatre cartes d’indicateurs colorées (moyenne, rang, mention, nombre de matières) ; graphique horizontal des moyennes ramenées sur 20 avec trait du seuil 10/20 (jusqu’à 12 matières) ; tableau à lignes alternées avec en-tête répété à chaque page ; appréciation dans un encadré ; décision du conseil ; signatures en bas de la dernière page ; pied de page « Page X / Y » sur chaque page.
- Tests : unitaires 28/28 (ajout : couleurs, arrondis, compression, pieds de page, bulletin) ; intégration 104/104 (les assertions sur le texte des PDF lisent désormais le contenu décompressé).
- Vérification visuelle : rendu contrôlé page par page (bulletin de 8 matières sur 2 pages, bulletin de 30 matières sur 2 pages avec en-tête répété et lignes alternées). Deux défauts trouvés et corrigés pendant la vérification : création de page incorrecte et chevauchement des libellés d’en-tête.
- Hors périmètre de cette livraison : les reçus et les factures utilisent toujours leur mise en page actuelle (même moteur, nouvelle mise en page à prévoir).

### 7.7 Reçus et factures dans la charte commune — Réalisé et vérifié
- Nouveau module `backend/src/utils/pdfTheme.js` : palette, bandeau de marque, cartes, pastilles de statut, pied de page numéroté (mentions légales optionnelles), partagés par les documents.
- Reçu de paiement (`receiptPdf.js`) : bandeau, carte élève, carte « Montant reçu » colorée, pastille ENCAISSÉ ou ANNULÉ, détails, montant en lettres, zone de signature.
- Facture et avoir (`invoiceData.js`) : bandeau (FACTURE ou AVOIR), cartes « Facturé à » et « Dates », tableau de prestations à ligne alternée, statut coloré, bloc de totaux (total mis en valeur), modalités de paiement, mentions légales au pied.
- Correction pendant la vérification : date du pied de page de la facture affichée au format brut.
- Tests : unitaires 29/29 (ajout : reçu, facture, avoir, format de date du pied) ; intégration 104/104.
- Vérification visuelle : reçu encaissé, reçu annulé, facture en attente, avoir.

### 7.8 Logo de l’établissement dans les documents — Réalisé et vérifié
- Décodage sans dépendance (`backend/src/utils/imageDecode.js`) : PNG (filtres de ligne, palettes, 1 à 16 bits, transparence) décodé vers RGB + canal alpha ; JPEG intégré tel quel ; WebP et formats non pris en charge refusés (le document s’affiche sans logo).
- Moteur PDF : `image()` pour intégrer les images (XObject, masque alpha).
- Chargement (`backend/src/utils/brandLogo.js`) : logo de l’établissement pour le bulletin, le reçu et les factures de l’établissement ; logo de la plateforme pour les factures d’abonnement (émetteur).
- Affichage : vignette blanche arrondie à gauche du bandeau, nom de l’établissement décalé.
- Tests unitaires 32/32 (PNG RGBA, palette avec tRNS, filtre Sub, JPEG, WebP refusé, XObject). Intégration 108/108 : sans logo, logo valide intégré, logo illisible sans échec de génération, suppression.
- Vérification visuelle : bulletin, reçu avec logo PNG semi-transparent. Palette à transparence et JPEG vérifiés séparément.
- Limite connue : les factures et les reçus longs ne sont pas paginés automatiquement (cas courants : une page).

### 7.9 Identité : site réservé au superadmin, établissement maître de son compte — Réalisé et vérifié
Règle retenue le 19/11/2026 :
- **Site (plateforme)** : nom, slogan, logo et affiche par défaut sont modifiés par le superadmin uniquement (`/api/platform/identity`). Un administrateur d’établissement reçoit 403.
- **Établissement** : son administrateur gère le nom, le slogan, le logo utilisé sur ses documents (bulletins, reçus, factures) et son affiche d’accueil (`/api/settings/identity`, `/api/settings/banner`).
- **Superadmin, par établissement** : `GET | PUT | DELETE /api/platform/tenants/:tenantId/identity[/text|/logo]` et `GET | PUT | DELETE /api/platform/tenants/:tenantId/banner[/text|/image]`, avec vérification de l’établissement (UUID invalide : 400 ; inconnu : 404). Ces routes servent à la fiche établissement du superadmin.
- Frontend : Paramètres de l’établissement inchangés pour l’administrateur ; la fiche établissement du superadmin affiche l’identité et l’affiche de cet établissement, avec un aperçu propre (sans toucher à l’identité de la session).
- Quotas du contrat : appliqués à la création d’élèves (`POST /api/students`) et d’utilisateurs (`POST /api/users`) par `middleware/quota.js`. Les comptes parents ne comptent pas dans le quota d’utilisateurs.
- Tests : unitaires 32/32 ; intégration 109/109, dont le superadmin qui édite l’identité d’un établissement et la refus de la même écriture à son administrateur, et le refus sur l’identité du site.
- Non vérifié : parcours navigateur de la fiche établissement.

**Points ouverts** : les deux points relevés sont traités en 7.10. Reste ouvert : le quota des « contacts » (responsables d’élèves), qui n’existe pas dans le modèle de contrat — à confirmer.

### 7.10 Quotas : verrou transactionnel et réactivation contrôlée — Réalisé et vérifié
- Le contrôle du quota est refait à l’intérieur de la transaction qui crée ou réactive le compte (`lockQuota`, `backend/src/middleware/quota.js`), sous verrou consultatif transactionnel par établissement et par type (`pg_advisory_xact_lock`). Le contrôle rapide du middleware reste en amont.
- Appliqué à : création d’élève (`POST /api/students`), création d’utilisateur (`POST /api/users`, sauf compte parent), réactivation d’un compte inactif (`PUT /api/users/:id` avec `is_active: true`).
- Réponse à la limite : 403 avec `code: "quota_exceeded"`.
- Tests : intégration 110/110, dont une réactivation refusée à la limite (compte resté inactif) et six créations simultanées avec deux places libres (exactement deux créées, quatre refusées). Unitaires 32/32.
- Non vérifié : que ce test échoue sur l’ancien code (non relancé sur la version antérieure).

## 8. Refonte UI — phase 2 (tableau de bord et affiche multi-images)

Réalisé et vérifié :
- Tableau de bord conforme à la maquette : ligne de bienvenue et date, quatre cartes (élèves, enseignants, classes, recettes) avec tendance calculée par le serveur ou « Pas de donnée », notes et présence moyenne, actions rapides, courbe des effectifs (6 mois), répartition par niveau, activités récentes, encaissements et paiements récents.
- Affiche d’accueil en diaporama de jusqu’à 6 images (migration 034, `/api/settings/banner/images`), image principale en premier, cadrage au clic, ordre, suppression ; ancienne affiche unique conservée en repli.
- Tests : unitaires 32/32 ; intégration 111/111 (PostgreSQL de test, migrations rejouées) ; recettes navigateur 18/18 et 9/9 ; captures contrôlées (tableau de bord, gestionnaire d’affiche).

Non réalisé dans cette phase : menu à sous-sections de la maquette, responsive mobile détaillé, pages modules restantes.

## 9. Refonte UI — phase 3 (menu à sous-sections et mobile)

Réalisé et vérifié :
- Menu latéral selon la maquette : rubriques repliables (Établissement, Utilisateurs, Gestion académique, Finances, Stock & Matériel, Communications, Rapports, Paramètres), groupe actif ouvert automatiquement, groupes sans module autorisé masqués.
- Rattachement des modules aux rubriques (décision de regroupement) : Établissement = Classes, Emploi du temps, Documents ; Utilisateurs = Élèves, Enseignants, Personnel (RH) ; Gestion académique = Notes, Présences ; Finances = Paiements ; Stock & Matériel = Stocks, Bibliothèque, Cantine, Transport ; Communications = Messages, Communication ; Rapports ; Paramètres = Configuration.
- « Aide & Support » affiché comme « À venir », non cliquable (aucun contenu réel à ce stade).
- Vérification : tous les identifiants de module du menu précédent sont conservés (comparaison avec HEAD).
- Mobile (390 px) : aucun débordement horizontal, menu en panneau fonctionnel, contraste de l'affiche renforcé.
- Tests : unitaires 32/32 ; intégration 111/111 ; recettes navigateur 18/18 et 9/9 après réinitialisation de la base de test. Les recettes ouvrent désormais la rubrique avant de cliquer sur un module (`navTo`).

Non vérifié : tablette (768–1023 px) et navigateur autre que Chromium.

## 10. Refonte UI — phase 4 (pages de liste des modules)

Réalisé et vérifié :
- Toutes les pages de liste (élèves, enseignants, classes, notes, présences, paiements, stocks, etc.) partagent un même gabarit : carte « panel », en-tête de tableau en majuscules, lignes survolées, bouton principal aux couleurs de la maquette.
- Captures contrôlées : liste des élèves sur ordinateur (1440 px) et tablette (900 px), sans débordement horizontal.
- Tests : unitaires 32/32 ; intégration 111/111 ; recettes navigateur 18/18 et 9/9 (base réinitialisée).

Non vérifié : écrans de formulaire (modales) et pages notes / paiements capturées une à une ; tablette avec d'autres modules.

## 11. Refonte UI — phase 5 (contrôle des formulaires, notes et paiements)

Vérifié visuellement (captures sur ordinateur 1440 px) :
- Modale « Ajouter un élève » : champs, libellés obligatoires, boutons Annuler / Enregistrer alignés sur la maquette.
- Modale « Ajouter un paiement » : fonctionnelle, mais deux champs élève à la suite (recherche puis liste) : à simplifier.
- Page Notes : statuts Saisie / Validée / Annulée et actions par ligne cohérents.

Vérifié fonctionnellement (non modifié en phase 5) : parcours de notes et de paiements couverts par les recettes navigateur 18/18 et les tests d'intégration 111/111 (rejoués sur base réinitialisée).

Non vérifié : messages d'erreur de validation affichés dans les modales ; modale de modification ; tablette sur les modales.

## 12. Refonte UI — phase 5 (suite) : sélection d'élève, erreurs de modale, tablette

Réalisé et vérifié :
- Sélection d'élève (paiements, notes, présences) : un seul champ de recherche, liste cliquable des résultats (8 maximum), élève sélectionné affiché et confirmé ; l'identifiant n'est transmis qu'après choix. Vérifié dans le navigateur : sélection puis enregistrement, la modale se ferme.
- Erreur de champ obligatoire : la modale nomme désormais les champs manquants (« Renseignez : Élève, Montant (F CFA) ») avant tout envoi. Avant : « Champ obligatoire ; Champ obligatoire ».
- Erreur serveur : montant invalide affiché dans la modale (« Doit être un nombre »). Limite connue : le message serveur ne nomme pas le champ.
- Tablette 768 px et 1024 px : aucun débordement de page, modales et liste de résultats lisibles. Cellules des listes sur une ligne, défilement horizontal dans la carte si nécessaire.
- Tests : unitaires 32/32 ; intégration 111/111 ; recettes navigateur 18/18 et 9/9 (base réinitialisée).

Non vérifié : modale de modification ; tablettes réelles (seul le moteur Chromium en émulation a été utilisé).

## 13. Refonte UI — messages de champ et modale de modification

Réalisé et vérifié (navigateur, Chromium en émulation) :
- Erreurs serveur de champ : chaque message est rattaché au libellé du champ fautif (« Montant (F CFA) : Doit être un nombre »). Aucune modification de l'API : le nom du champ est déjà fourni par le serveur et traduit côté interface.
- Champs obligatoires : « Renseignez : Élève, Montant (F CFA). » avant tout envoi.
- Modale « Modifier l'élève » : pré-remplie, champ obligatoire vide refusé avec message, enregistrement valide ferme la modale.
- Tests : unitaires 32/32 ; intégration 111/111 ; recettes navigateur 18/18 et 9/9 (base réinitialisée).

Non vérifié : messages serveur dans toutes les modales (seuls élève et paiement ont été contrôlés) ; modification sur tablette.

## 14. Messages de champ sur les autres modales (contrôle sans modification de code)

Vérifié dans le navigateur (Chromium en émulation) :
- Notes : « Renseignez : Élève, Matière, Note (sur 20). » ; note 99 refusée : « Note (sur 20) : Doit être inférieur ou égal à 20 ».
- Classes : « Renseignez : Nom de la classe. » ; effectif -4 refusé : « Effectif maximum : Doit être supérieur à 0 ».
- Présences : « Renseignez : Élève, Date. ».

Non modifié : aucune anomalie trouvée sur ces modales.
Non vérifié : modales Enseignants, Bibliothèque, Stocks ; tablette.

## 15. Messages de champ : enseignants, bibliothèque, stocks (contrôle sans modification de code)

Vérifié dans le navigateur (Chromium en émulation) :
- Enseignants : « Renseignez : Prénom, Nom. » ; e-mail invalide : « E-mail : Adresse e-mail invalide ».
- Bibliothèque : « Renseignez : Titre. ».
- Stocks : « Renseignez : Article. » ; quantité non numérique : « Quantité : Doit être un nombre ».

Non modifié : aucune anomalie trouvée. Non vérifié : ces modales sur tablette.

## 16. Modales sur tablette (768 px et 1024 px, émulation Chromium)

Vérifié :
- Modale « Ajouter un élève » : entièrement visible à l'écran, sans débordement, message d'erreur lisible (« Renseignez : Matricule, Prénom, Nom. »).
- Modale « Ajouter un paiement » à 768 px : liste de résultats de la recherche d'élève lisible (vérifié en phase 5 suite).
- Aucun débordement horizontal de page.

Non vérifié : appareils physiques (seule l'émulation Chromium a été utilisée) ; modales de notes, classes et stocks sur tablette.

## 17. Refonte UI — phase 6 : fiche élève et en-têtes de tableaux

Réalisé et vérifié :
- Fiche « Dossier individuel de l'élève » : vérifiée dans le navigateur (1440 px), aucune erreur de page.
- En-têtes de tableau uniformisés dans toute l'application (14 styles d'en-tête et 56 cellules d'en-tête alignés sur le gabarit des listes). Modification de classes CSS uniquement, sans changement de logique.
- Tests : unitaires 32/32 ; intégration 111/111 ; recettes navigateur 18/18 et 9/9 (base réinitialisée).

Non vérifié : fiche élève sur tablette et les autres tableaux un par un (rendu contrôlé sur la seule fiche élève et la liste élèves).

## 18. Vérification tablette : liste élèves et fiche élève (768 px et 1024 px, émulation Chromium)

- Liste élèves et fiche élève : aucun débordement horizontal de page à 768 ni à 1024 px.
- Fiche élève à 768 px : informations, responsables et sections d'historique lisibles.
- Limite : la fiche a été contrôlée sans historique rempli ; les tableaux avec données défilent dans leur carte (`overflow-x-auto`), comportement non vérifié visuellement sur données réelles.
- Aucun changement de code dans cette étape.

## 19. Finances : factures familiales et affectation des paiements

Périmètre retenu : factures par élève, grilles de frais, paiements affectés aux factures, soldes et impayés.
Décisions : annulation d'une facture = libération de ses affectations (la facture reste consultable, statut « Annulée ») ; numérotation FAC-000001 par établissement.

Réalisé et vérifié :
- Migration 035 (additive) : fee_structures, student_invoices, invoice_items, payment_allocations ; index unique (id, tenant_id) sur students.
- API /api/invoices (droit « Paiements » : lecture, écriture pour le comptable et l'administrateur) : grilles de frais, création avec total calculé par le serveur, détail avec solde, affectation dans une transaction à verrous de ligne, retrait d'affectation, annulation journalisée.
- Interface : entrée « Factures » dans Finances, liste filtrable et paginée, création avec lignes multiples et choix dans la grille, détail avec affectation, retrait et annulation.
- Tests d'intégration ajoutés (6) : calcul serveur et numérotation ; lignes invalides, élève d'un autre établissement, rôle sans droit ; affectation bornée au solde facture et au solde paiement ; mauvais élève, paiement non encaissé, paiement d'un autre établissement ; deux affectations simultanées sur le même reste (une seule réussit) ; annulation libérant les affectations.
- Recette navigateur `recette-factures.js` (8/8) : création via l'interface, total à l'écran, affectation de 5 000 F, solde recalculé, statut « Partielle », aucune erreur JavaScript.
- Tests : unitaires 32/32 ; intégration 117/117 ; recettes phase1 18/18, messagerie 9/9, factures 8/8.

Non vérifié : factures sur tablette ; données réelles de volume ; droits des rôles autres que administrateur et comptable sur les factures (couverts par les tests d'accès, pas par une recette navigateur).
Ajout (même phase) : PDF de facture (GET /api/invoices/:id/invoice.pdf, droit « Paiements ») et envoi aux responsables (POST /api/invoices/:id/send, écriture « Paiements ») : destinataires = responsables liés à l’élève ayant un e-mail ; envoi via la file mail_outbox (kind « family_invoice »), journalisé dans l’audit. Refus 422 sans adresse, 409 si annulée.
Tests : intégration 119/119 (PDF, isolation, envoi, refus) ; recette factures 10/10 (téléchargement du PDF, message d’envoi) ; phase1 18/18 ; messagerie 9/9 ; unitaires 32/32.
Limites : envoi réel non vérifié (SMTP non configuré en test : statut « skipped ») ; une relance depuis la file n’a pas de pièce jointe régénérée pour ces factures ; lien facture ↔ reçu non traité ; PDF d’une facture de plus de ~18 lignes non vérifié.

### Complément : lien facture ↔ reçu, envoi SMTP réel, pagination
- Reçu PDF : section « Affecté aux factures » (numéros des factures, montants, reste non affecté).
- Facture PDF : tableau sur plusieurs pages, entête répétée ; une facture de 30 lignes (2 pages) vérifiée. Corrections : unitaire et montant ne se chevauchent plus ; séparateur de milliers rendu correctement ; solde affiché à 0 pour une facture annulée.
- Envoi réel : serveur SMTP de test, message reçu avec pièce jointe PDF, destinataire = responsable de l’élève.
- Tests : intégration 120/120 ; recettes phase1 18/18, messagerie 9/9, factures 10/10 ; unitaires 32/32.
- Limites restantes : relance depuis la file sans pièce jointe régénérée ; SMTP réel d’établissement non testé ; PDF de plus de 2 pages vérifié seulement jusqu’à 2.

### Complément : relance d’un envoi de facture familiale
- La relance (superadmin, file d’envoi) régénère désormais la pièce jointe à partir de la facture actuelle. Une facture annulée entre-temps n’est pas envoyée (réponse 502, aucun envoi).
- Test : envoi consigné sans SMTP, relance après configuration (message reçu avec la facture PDF), relance refusée pour une facture annulée.
- Tests : intégration 121/121 ; recettes phase1 18/18, messagerie 9/9, factures 10/10 ; unitaires 32/32.
- Limite : la relance est réservée au superadmin (file de la plateforme) ; l’établissement relance en renvoyant l’envoi depuis le détail de la facture.

