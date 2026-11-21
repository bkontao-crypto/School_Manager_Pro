# État actuel — SCHOOL MANAGER PRO
**Date :** 2026-11-21 — **Branche de travail :** `refonte-ui-phase1` — **Dernier commit :** voir `git log -1` (poussé ; PR #3 en brouillon, non fusionnée)

## Dernière phase terminée et vérifiée
Modules financiers, premier périmètre : factures familiales, affectation des paiements, PDF de facture et envoi aux responsables (migration 035, API /api/invoices, onglet Finances › Factures). Détail : `RAPPORT_TESTS_PHASE1.md` section 19.

## Tests exécutés (sur ce commit)
- Unitaires : 32/32
- Intégration (PostgreSQL de test, migrations rejouées) : 122/122
- Recettes navigateur : phase1 18/18, messagerie 9/9, factures 10/10

## Problèmes ouverts
- PR #3 : à fusionner seulement sur autorisation.
- Branche `retrait-audit-cookies-traceurs` : décision de fusion en attente.
- Quota « contacts / responsables » non défini dans le modèle de contrat.
- « Aide & Support » : pas d'implémentation (affiché « À venir »).
- Police Poppins : choix provisoire, à confirmer.
- Messages de champ : vérifiés sur élève, paiement, notes, classes et présences. Enseignants, bibliothèque et stocks vérifiés aussi.
- Tablettes réelles : non vérifiées (émulation Chromium 768 et 1024 px uniquement).
- Factures : SMTP d’établissement réel non testé ; la relance de la file est réservée au superadmin.
- Paiement en ligne Orange Money / Moov Money : non configuré (voir `ROADMAP_SUIVI.md`).
- `docs/SUIVI_EXECUTION_SCHOOL_MANAGER_PRO.xlsx` : non régénéré depuis la phase 2 (sur demande uniquement).

## Prochaine tâche
À proposer : page d’accueil publique (vitrine) si vous la souhaitez, ou prochain module à traiter.
