// État de licence d'un établissement (suspension, expiration) : règle unique partagée par la connexion,
// le contrôle de chaque requête et l'écran superadmin.

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// -> 'suspended' | 'expired' | 'expiring' (≤ 30 jours) | 'unlimited' | 'ok'
function licenseState(t, now = today()) {
  if (t.status === 'suspended') return 'suspended';
  if (!t.license_end) return 'unlimited';
  if (t.license_end < now) return 'expired';
  if (t.license_end <= addDays(now, 30)) return 'expiring';
  return 'ok';
}

// Retourne null si l'établissement peut travailler, sinon { code, message } (utilisé pour refuser l'accès).
function accessProblem(t, now = today()) {
  const state = licenseState(t, now);
  if (state === 'suspended') return { code: 'tenant_suspended', message: 'Établissement suspendu. Contactez l’éditeur du logiciel.' };
  if (state === 'expired') return { code: 'license_expired', message: 'Licence expirée. Contactez l’éditeur du logiciel pour la renouveler.' };
  return null;
}

module.exports = { licenseState, accessProblem, today, addDays };
