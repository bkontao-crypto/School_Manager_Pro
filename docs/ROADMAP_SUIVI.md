# Feuille de route de suivi — SCHOOL MANAGER PRO
**Version :** 2.22.0 — **Date :** 2026-11-15
Le détail des corrections issues de l'audit est dans `docs/AUDIT_SUIVI.md`.

## Fait (socle)
- [x] Multi-établissements strict : isolation par jeton, clés composites, `NOT NULL` (migration 013)
- [x] Authentification JWT, rôles, limitation de débit, en-têtes de sécurité
- [x] Écrans : emploi du temps, rapports (+ export CSV), paramètres, utilisateurs, fil de messages, RH, documents, stocks
- [x] Modules connectés : élèves (dossier individuel, suppression logique), classes, enseignants, présences, notes, paiements (reçus numérotés), messagerie, documents, stocks, notifications, RH, bibliothèque, cantine, transport
- [x] Tableau de bord alimenté par des statistiques SQL
- [x] Refonte UI phase 4 : pages de liste des modules alignées sur la maquette (ordinateur et tablette vérifiés)
- [x] Refonte UI phase 3 : menu latéral à rubriques repliables selon la maquette, mobile 390 px (branche `refonte-ui-phase1`)
- [x] Refonte UI phase 2 : tableau de bord selon la maquette (tendances serveur ou « Pas de donnée »), affiche d'accueil en diaporama de 6 images maximum (branche `refonte-ui-phase1`)
- [x] Interface locale (sans CDN), connexion, modales, PWA testée hors ligne
- [x] Tests automatisés (unitaires + intégration)
- [x] Affiche d'accueil personnalisable par établissement (exigences de format, taille, résolution) + affiche par défaut
- [x] Espace superadmin : établissements, packs, licences, quotas, suspension sans suppression, mots de passe des administrateurs, journal
- [x] Facturation des abonnements (factures, encaissement, prolongation de licence, export CSV) et export CSV des établissements
- [x] Identité personnalisable (nom, slogan, logo) : plateforme et établissements
- [x] Rappels automatiques par e-mail (licences, factures impayées), journal et écran « E-mails » (v2.11.0)
- [x] Factures : envoi par e-mail, TVA, remises, avoirs, mentions légales (v2.11.0)
- [x] Factures familiales (refonte finances, migration 035) : grilles de frais par établissement, factures par élève numérotées FAC-000001, lignes calculées côté serveur, affectation de paiements encaissés (même élève, pas de sur-affectation, verrous de ligne), retrait d’une affectation, annulation qui libère les affectations
- [x] Mot de passe oublié par e-mail (v2.11.0)
- [x] Bulletin : appréciation de l'enseignant et décision du conseil, impression / PDF (v2.11.0)
- [x] Sauvegarde / restauration et guide de déploiement Windows (v2.11.0)
- [x] Photos d'élèves téléversées de façon sécurisée ; emploi du temps : vue par enseignant et salles en conflit (v2.12.0)
- [~] Paiement en ligne Orange Money / Moov Money : présent dans l'interface mais **désactivé (indisponible)** — intégration réelle à faire

## Reste à faire
- [ ] Vérifier l'ensemble sur un vrai PostgreSQL + Express installés (les tests ont été exécutés avec un banc de simulation, voir AUDIT_SUIVI)
- [ ] `package-lock.json` (nécessite `npm install` avec accès au registre)
- [ ] Paiement en ligne réel (contrat marchand Orange Money / Moov Money, API, notification serveur)
- [x] Permissions fines par module et par rôle, configurables par l'administrateur (v2.13.0)
- [x] Portail parent limité aux enfants rattachés (v2.14.0)
- [x] Export PDF serveur des bulletins (v2.15.0)
- [x] Notifications aux parents par SMS, WhatsApp et e-mail : envoi groupé, alerte d'absence, préférences (v2.16.0)
- [x] Affichage sur téléphone : menu en panneau, en-tête et barres d'outils adaptés (v2.22.0)
- [x] Exports Excel (CSV) des élèves, notes et paiements (v2.21.0)
- [x] Reçus de paiement en PDF avec montant en lettres, côté administration et portail parent (v2.20.0)
- [x] Audit de sécurité final et plafond journalier de SMS / WhatsApp (v2.19.0)
- [x] PDF des factures et avoirs joints aux e-mails + téléchargement (v2.18.0)
- [x] Rappels d'impayés aux parents (manuel et automatique) par SMS, WhatsApp, e-mail (v2.17.0)
- [ ] Notifications : fournisseur réel à configurer (compte Twilio, numéro expéditeur, modèles WhatsApp approuvés par Meta pour écrire hors fenêtre de 24 h)

## Risques
- Données de mineurs : durcir les accès (journal de consultation, rôles fins) avant mise en production.
- Jeton stocké dans le navigateur (`localStorage`) : acceptable avec la CSP stricte ; à remplacer par un cookie `HttpOnly` si l'exposition l'exige.
