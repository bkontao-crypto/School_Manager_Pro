# Décisions à prendre — Phase 1 (17/11/2026)

Trois choix changent le comportement de l'application. Je ne les ai pas tranchés seul.

## D1 — Lecture des paiements par défaut
**Problème.** Par défaut, les rôles `teacher`, `staff` et `user` peuvent lire le module Paiements (et, depuis la correction du tableau de bord, les encaissements affichés sur l'accueil). L'ordonnance §4.2 demande de ne pas exposer les paiements à un profil non autorisé.
**Options.**
- A. Garder la lecture par défaut ; l'administrateur restreint au cas par cas dans Paramètres → Permissions.
- B. Retirer la lecture par défaut aux rôles `teacher`, `staff` et `user` ; seuls `accountant` et `admin` voient les paiements.
- C. Garder pour `teacher`, retirer pour `staff` et `user`.
**Recommandation.** B. C'est le cas le plus courant dans les écoles, et l'administrateur peut toujours ouvrir l'accès. Changement : une ligne dans `utils/permissions.js` (valeurs par défaut) et des tests par rôle.
**Choix attendu :** A, B ou C.

## D2 — Lecture des ressources humaines par défaut
**Problème.** Le module RH est lisible par défaut par tous les rôles du personnel. §4.2 demande de ne pas exposer les informations RH.
**Options.**
- A. Lecture réservée à `admin` par défaut.
- B. Lecture pour `admin` et `accountant` (paie).
- C. Garder la lecture par défaut.
**Recommandation.** A.
**Choix attendu :** A, B ou C.

## D3 — Messagerie : qui voit les conversations existantes ?
**Problème.** La migration 026 rattache à chaque conversation ses expéditeurs actuels. Une conversation sans message, ou dont l'expéditeur a quitté l'établissement, ne sera visible par personne après la correction de la route.
**Options.**
- A. Le créateur, s'il est connu, et l'administrateur ont accès à toute conversation ; les autres participants seulement s'ils y sont ajoutés.
- B. Seuls les participants (y compris les expéditeurs) ont accès ; l'administrateur n'a pas d'accès automatique.
- C. Toutes les conversations existantes restent visibles pour l'administrateur uniquement, le reste s'applique à partir de maintenant.
**Recommandation.** A : l'administrateur doit pouvoir gérer les conversations de son établissement, et le cloisonnement reste strict pour les autres.
**Choix attendu :** A, B ou C.

Une réponse sur ces trois points suffit pour que je poursuive la Phase 1 avec les tests négatifs prévus.

## Décisions acceptées (18/11/2026)

- **D4 — Demande de correction bloquée (administrateur unique)** : retrait par l'auteur, route `POST /api/grades/corrections/:cid/withdraw`, statut `withdrawn` (migration 030). Pas de décideur de secours. Décision tracée avec motif.
- **D5 — Statuts des notes** : conserver `saisie`, `validee`, `annulee`. Pas d'étape « soumise » pour l'instant.
- **D6 — Stockage des documents** : dossier privé persistant (`DOCUMENTS_DIR`), accès uniquement par route authentifiée. Stockage objet en production plus tard. Dépendance `multer` 2.5.0 (publiée le 22/10/2026) acceptée.
- **D7 — Rôle élève** : reporté à la Phase 5 (accès en lecture seule, règles de protection des mineurs).
- **D8 — Messagerie des parents** : exclusion confirmée jusqu'à la Phase 5.
- **D9 — Libellé du bulletin** : « Nb notes » au lieu de « Notes ».
- **D10 — Fusion dans `main`** : non effectuée. Elle sera proposée après la recette navigateur complète.
- **D11 — Anciennes branches distantes** : suppression manuelle par le propriétaire du dépôt.

## D12 — Notes antérieures à la Phase 1 (19/11/2026)
Décision de l’établissement : les notes existantes en `saisie` sont validées automatiquement par la migration 033, avec conservation du statut d’origine et trace d’audit. Retour arrière documenté dans la migration.

## D13 — Identité et affiche réservées au superadmin (19/11/2026)
Décision demandée par la direction de la plateforme : l’établissement ne modifie ni le nom, ni le slogan, ni le logo, ni l’affiche de l’application. Il gère uniquement ses comptes et sous-comptes. Les écritures passent par `/api/platform/tenants/:tenantId/…`. Hypothèse à confirmer : le logo des documents de l’établissement suit la même règle.
