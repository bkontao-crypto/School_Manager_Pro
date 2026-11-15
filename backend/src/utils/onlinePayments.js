// Paiement en ligne des abonnements (Orange Money, Moov Money).
// ÉTAT ACTUEL : INDISPONIBLE. Les fournisseurs sont déclarés pour que l'interface les affiche, mais l'intégration
// (identifiants marchands, interface de paiement, confirmation par notification serveur) n'est pas réalisée.
// Aucune variable d'environnement ne peut l'activer : une intégration réelle devra remplacer ce module.
const REASON = 'Indisponible pour le moment : l’intégration avec l’opérateur n’est pas encore activée (identifiants marchands requis).';

const PROVIDERS = Object.freeze([
  Object.freeze({ code: 'orange_money', name: 'Orange Money', enabled: false, reason: REASON }),
  Object.freeze({ code: 'moov_money', name: 'Moov Money', enabled: false, reason: REASON })
]);

const UNAVAILABLE = Object.freeze({
  code: 'online_payment_unavailable',
  message: 'Le paiement en ligne n’est pas encore disponible. Veuillez régler auprès de l’éditeur (espèces, virement, Orange Money ou Moov Money en direct, chèque).'
});

module.exports = { PROVIDERS, UNAVAILABLE, REASON };
