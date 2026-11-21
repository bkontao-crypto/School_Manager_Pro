# État actuel — SCHOOL MANAGER PRO
**Date :** 2026-11-20 — **Branche de travail :** `refonte-ui-phase1` — **Dernier commit :** `3e71041` (poussé, PR #3 en brouillon, non fusionnée)

## Dernière phase terminée et vérifiée
Phase 6 : fiche élève vérifiée, en-têtes de tableaux uniformisés. Vérification tablette de la liste élèves et de la fiche faite (768 et 1024 px). Phase 5 : modales et messages de champ vérifiés. Phase 3 (menu) et phase 2 (tableau de bord, affiche) déjà vérifiées.

## Tests exécutés (sur ce commit)
- Unitaires : 32/32
- Intégration (PostgreSQL de test, migrations rejouées) : 111/111
- Recettes navigateur : 18/18 (`recette-phase1.js`) et 9/9 (`recette-messagerie.js`)
- Captures contrôlées : tableau de bord, gestionnaire d'affiche, graphiques

## Problèmes ouverts
- PR #3 : à fusionner seulement sur autorisation.
- Branche `retrait-audit-cookies-traceurs` : décision de fusion en attente.
- Quota « contacts / responsables » non défini dans le modèle de contrat.
- « Aide & Support » : pas d'implémentation (affiché « À venir »).
- Police Poppins : choix provisoire, à confirmer.
- Messages de champ : vérifiés sur élève, paiement, notes, classes et présences. Enseignants, bibliothèque et stocks vérifiés aussi.
- Tablettes réelles : non vérifiées (émulation Chromium 768 et 1024 px uniquement).
- Paiement en ligne Orange Money / Moov Money : non configuré (voir `ROADMAP_SUIVI.md`).
- `docs/SUIVI_EXECUTION_SCHOOL_MANAGER_PRO.xlsx` : non régénéré depuis la phase 2 (sur demande uniquement).

## Prochaine tâche
À proposer : phase suivante, modules financiers (factures et reçus).
