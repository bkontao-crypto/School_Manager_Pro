# État actuel — SCHOOL MANAGER PRO
**Date :** 2026-11-20 — **Branche de travail :** `refonte-ui-phase1` — **Dernier commit :** `3e71041` (poussé, PR #3 en brouillon, non fusionnée)

## Dernière phase terminée et vérifiée
Refonte UI phase 2 : tableau de bord conforme à la maquette, affiche d'accueil multi-images (migration 034, `/api/settings/banner/images`), gestionnaire d'affiche dans les paramètres.

## Tests exécutés (sur ce commit)
- Unitaires : 32/32
- Intégration (PostgreSQL de test, migrations rejouées) : 111/111
- Recettes navigateur : 18/18 (`recette-phase1.js`) et 9/9 (`recette-messagerie.js`)
- Captures contrôlées : tableau de bord, gestionnaire d'affiche, graphiques

## Problèmes ouverts
- PR #3 : à fusionner seulement sur autorisation.
- Branche `retrait-audit-cookies-traceurs` : décision de fusion en attente.
- Quota « contacts / responsables » non défini dans le modèle de contrat.
- Menu latéral : sous-sections de la maquette non implémentées.
- « Aide & Support » : pas d'implémentation (aucun bouton sans action).
- Police Poppins : choix provisoire, à confirmer.
- Responsive mobile détaillé : à vérifier.
- Paiement en ligne Orange Money / Moov Money : non configuré (voir `ROADMAP_SUIVI.md`).
- `docs/SUIVI_EXECUTION_SCHOOL_MANAGER_PRO.xlsx` : non régénéré depuis la phase 2 (fichier régénéré seulement sur demande).

## Prochaine tâche
Phase 3 proposée : menu latéral à sous-sections de la maquette, puis responsive mobile. En attente de confirmation.
