# Plan de tests — v2.22.0

## Automatisés
| Suite | Commande | Contenu |
|---|---|---|
| Unitaires (25) | `npm test` | JWT (falsification, expiration, alg=none), scrypt, validation, limiteur de débit, middlewares d'authentification, configuration |
| Intégration (83) | `TEST_DATABASE_URL=…_test npm run test:integration` | Migrations 001-025 sur base vierge ; connexion et jetons ; droits par rôle ; isolation entre deux établissements (y compris en-tête `x-tenant-id` falsifié) ; validation 400 ; doublons 409 ; références croisées 422 ; reçus sans trou ; présences en double ; pagination ; recherche sans jokers ; suppression logique ; audit ; statistiques ; modules simples ; emploi du temps (chevauchements) ; rapports et CSV ; paramètres, utilisateurs, mot de passe ; fil de messages ; révocation immédiate des sessions ; réinitialisation de mot de passe ; bulletin (moyennes, rang, période) ; périodes scolaires |

- Affiche d'accueil : 5 tests unitaires (lecture PNG/JPEG/WebP, SVG refusé, ratio, résolution, poids) et 1 test d'intégration (droits, refus 400/413, isolation entre établissements, textes, réinitialisation) ; vérifié aussi dans Chromium (refus d'une image 4:1 non conforme, publication, retour au défaut, aucune violation CSP).
- Espace superadmin : 8 tests d'intégration (droits, création avec pack et mot de passe temporaire, validation, quotas élèves/utilisateurs, suspension et réactivation, licence expirée et renouvellement, mots de passe et désactivation des administrateurs, packs, vue d'ensemble et journal sans fuite) ; vérifié dans Chromium (parcours complet, aucune violation CSP).
- Facturation : 4 tests d'intégration (création et numérotation, encaissement et prolongation de licence, doubles paiements, annulation, retard, totaux, CSV avec BOM et anti-formule, « Mon abonnement », isolation). Identité : 3 tests (public, plateforme, héritage et surcharge par établissement, logo refusé / accepté, isolation) + 1 test unitaire logo. Vérifié dans Chromium : logo et nom appliqués au menu, à la connexion et au tableau de bord, facture, export CSV.
- v2.11.0 : 3 tests unitaires du client SMTP (faux serveur local : authentification, points en début de ligne, échecs) ; 9 tests d'intégration (sans / avec SMTP, TVA et remises, avoirs, envoi de facture, rappels sans doublon, mot de passe oublié à usage unique, paiement en ligne indisponible, commentaires de bulletin et isolation). Chromium : réglages, facture TVA, avoir, e-mail, écran E-mails, abonnement avec bouton grisé, bulletin imprimable, aucune violation CSP.
- v2.12.0 : 1 test unitaire (exigences photo) ; 2 tests d'intégration (salle occupée, vue par enseignant ; photo : droits, signature, taille, proportions, lecture, isolation, retrait). Chromium : envoi d'une photo de 1500×2000 px réduite à 600×800, refus de la salle occupée, vue par enseignant, aucune violation CSP.
- v2.22.0 : contrôle visuel automatisé à 390 px (aucun débordement horizontal sur 10 écrans) ; pas de changement d'API, tests existants inchangés.
- v2.21.0 : exports CSV (BOM UTF-8, formules neutralisées, filtres, isolation entre établissements, droits par module et permissions modifiées, parent fermé, journal d'audit).
- v2.20.0 : reçu PDF (contenu, montant en lettres, 409 si non encaissé, isolation entre établissements, parent limité à son enfant, parent fermé à la route d'administration) + montant en lettres (accords de cent, vingt, mille, million).
- v2.19.0 : plafond journalier de SMS / WhatsApp (au-delà : messages ignorés avec motif, rien n'est envoyé).
- v2.18.0 : pièce jointe MIME (multipart/mixed, base64 fidèle, nom assaini, texte seul) ; facture envoyée par e-mail avec PDF décodé et vérifié ; téléchargement PDF réservé au superadmin ; nouvel essai d'un envoi non parti : facture régénérée et jointe.
- v2.17.0 : rappels d'impayés (aperçu, envoi manuel groupé par parent avec détail par enfant, droits, réglages, rappels automatiques : seuil d'ancienneté, aucun doublon, 2e rappel après 14 jours, plus de rappel une fois payé, canal non configuré sans erreur). Chromium : section Impayés et envoi.
- v2.16.0 : 3 tests d'intégration avec faux fournisseur Twilio et faux SMTP (normalisation des numéros, canaux indisponibles → 409, envoi groupé SMS + WhatsApp + e-mail, personnalisation, préférences, refus du fournisseur consigné, droits, isolation, alerte d'absence unique par jour). Chromium : écran Communication, envoi vers le faux fournisseur.
- v2.15.0 : bulletin PDF (administrateur, parent de l'enfant seulement, droits de lecture, filtre invalide) + 3 tests unitaires du générateur.
- v2.14.0 : 4 tests d'intégration (responsables réutilisés entre frères et sœurs, création d'accès réservée à l'administrateur, isolation entre parents et établissements, portail fermé aux autres rôles, application fermée au parent sauf portail, quota et rôle figé, désactivation immédiate).
- v2.13.0 : 5 tests d'intégration (matrice par défaut, validation, retrait / octroi de droits avec effet immédiat, notes / bulletin / élèves / rapports, messagerie, isolation entre établissements, réinitialisation). Chromium : matrice, menu réduit pour l'enseignant, ajout d'élève accordé, API stocks 403.

## Manuels à faire avant mise en production
- [ ] Envoyer une vraie affiche du logo/photo de l'école (JPEG d'appareil photo, WebP) et vérifier le rendu sur téléphone
- [ ] `npm install` puis les deux suites sur une machine disposant d'Express et de `pg` réels
- [ ] Parcours complet dans un vrai navigateur sur Windows (connexion, élève, paiement, dossier imprimé)
- [ ] Installation de la PWA (Chrome / Android) et test hors ligne
- [ ] Envoi d'un e-mail de test avec vos vrais identifiants SMTP (écran « E-mails »)
- [ ] Sauvegarde / restauration PostgreSQL sous Windows (vérifiée sous Linux)
- [ ] Test de charge simple (liste des élèves avec plusieurs milliers de lignes)
