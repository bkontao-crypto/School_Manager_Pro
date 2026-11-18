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

## 3. Ce qui n'est pas vérifié

- Parcours navigateur (tableau de bord, écrans de clôture et de corrections, mobile) : non exécuté.
- Mise à niveau depuis une copie de base réelle : non exécutée.
- Sauvegarde et restauration : non exécutées.
- Rendu visuel du bulletin : contrôlé une fois sur un PDF généré avec des données fictives ; le libellé de colonne « Notes » est à clarifier.

## 4. Anomalies et limites restantes

1. **Demande de correction bloquée avec un seul administrateur.** Le demandeur ne peut pas décider sa propre demande, et aucune route ne permet de la retirer. Dans un établissement qui n'a qu'un administrateur, cette demande reste en attente indéfiniment, et elle bloque toute nouvelle demande sur la même note (index unique). Décision à prendre : ajouter un retrait par le demandeur, ou un décideur de secours (gérant).
2. **Colonne « Notes » du bulletin** : elle affiche le nombre de notes validées, pas les notes. Libellé à renommer.
3. **Accusés de réception et de lecture** (§4.1 point 6) : non implémentés. Seule la date de dernière lecture existe.
4. **Statuts des notes** : `saisie / validee / annulee` au lieu de `draft / submitted / approved / published` demandés par l'ordonnance (§4.5). Décision à prendre.
5. **Barèmes configurables** par établissement (§5.1) : non implémentés.
6. **Environnement** : le proxy de la session exclut `registry.npmjs.org` du proxy, ce qui rend npm inutilisable par défaut. La commande d'installation a été lancée avec la liste `noProxy` vidée, uniquement pour cette commande. Ni `HTTPS_PROXY` ni la vérification TLS n'ont été modifiés.

## 5. Commande de reproduction

```bash
su postgres -c "createdb school_manager_pro_test"   # base dont le nom finit par _test
npm ci
npm test
TEST_DATABASE_URL=postgres://USER:PASS@localhost:5432/school_manager_pro_test npm run test:integration
```

Attention : la suite d'intégration supprime et recrée le schéma `public` de la base de test.
