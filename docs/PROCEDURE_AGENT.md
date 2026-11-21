# Procédure de travail de l'agent — SCHOOL MANAGER PRO

## Règles permanentes
- Travailler sur une branche dédiée, jamais sur `main`. Ne fusionner qu'avec autorisation.
- Lire `docs/ETAT_ACTUEL.md` et `docs/ROADMAP_SUIVI.md` avant toute tâche. Ne pas refaire un audit complet sans raison.
- Ne rien marquer « terminé » sans test exécuté et résultat réel.
- Modifications ciblées, pas de réécriture de fichier entier pour une correction locale.
- Ne pas supprimer de fonctionnalité ou de donnée sans justification et validation.
- Pas de données de démonstration en production. Pas de bouton sans action.

## Commandes courtes
- REPRENDRE : lire `ETAT_ACTUEL.md`, reprendre la prochaine tâche non terminée.
- CONTINUER : exécuter la prochaine tâche prioritaire déjà définie.
- CORRIGER : traiter les anomalies indiquées, sans élargir le périmètre.
- AUDITER [périmètre] : examiner seulement ce périmètre.
- VALIDER [périmètre] : exécuter les tests ciblés, puis la suite complète si une phase se termine.
- LIVRER : fin de phase uniquement (voir ci-dessous).

## Tests
- Ciblés pendant le travail, suite complète en fin de phase :
  - `npm test` (unitaires)
  - `TEST_DATABASE_URL=… node --test tests/integration/api.test.js`
  - `node tests/browser/recette-phase1.js`, `recette-messagerie.js` et `recette-factures.js` (serveur sur le port 3100)

## Fin de phase (et seulement là)
1. Mettre à jour `docs/ETAT_ACTUEL.md` (dernière tâche, tests, problèmes ouverts, prochaine tâche).
2. Mettre à jour `docs/ROADMAP_SUIVI.md` (cocher les tâches vérifiées, sans pourcentage inventé).
3. Commit clair sur la branche, puis push.
4. Compte rendu court :
   - Statut : terminé et vérifié / partiel / bloqué
   - Réalisé
   - Fichiers modifiés
   - Tests et résultats
   - Risques
   - Branche et dernier commit
   - Prochaine tâche
5. Le ZIP du projet est livré en fin de phase seulement.
6. Le fichier xlsx n'est régénéré que sur demande.
