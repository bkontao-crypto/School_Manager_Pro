# État actuel — SCHOOL MANAGER PRO
**Date :** 2026-11-20 — **Branche de travail :** `refonte-ui-phase1` — **Dernier commit :** `3e71041` (poussé, PR #3 en brouillon, non fusionnée)

## Dernière phase terminée et vérifiée
Refonte UI phase 3 : menu latéral à rubriques repliables selon la maquette, mobile 390 px vérifié. Phase 2 (tableau de bord, affiche multi-images) déjà vérifiée.

## Tests exécutés (sur ce commit)
- Unitaires : 32/32
- Intégration (PostgreSQL de test, migrations rejouées) : 111/111
- Recettes navigateur : 18/18 (`recette-phase1.js`) et 9/9 (`recette-messagerie.js`)
- Captures contrôlées : tableau de bord, gestionnaire d'affiche, graphiques

## Problèmes ouverts
- PR #3 : à fusionner seulement sur autorisation.
- Branche `retrait-audit-cookies-traceurs` : décision de fusion en attente.
- Quota « contacts / responsables » non défini dans le modèle de contrat.
- Tablette (768–1023 px) : non vérifiée.
- « Aide & Support » : pas d'implémentation (aucun bouton sans action).
- Police Poppins : choix provisoire, à confirmer.
- Paiement en ligne Orange Money / Moov Money : non configuré (voir `ROADMAP_SUIVI.md`).
- `docs/SUIVI_EXECUTION_SCHOOL_MANAGER_PRO.xlsx` : non régénéré depuis la phase 2 (fichier régénéré seulement sur demande).

## Prochaine tâche
Phase 4 à proposer : pages modules (élèves, classes, notes, paiements) alignées sur la maquette, puis vérification tablette.
