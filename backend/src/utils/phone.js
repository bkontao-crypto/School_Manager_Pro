// Numéros de téléphone : normalisation au format international E.164 (+22376112233).
// Un numéro local de 8 chiffres est rattaché à l'indicatif par défaut (DEFAULT_COUNTRY_CODE, 223 = Mali).

function normalizePhone(raw, countryCode = (process.env.DEFAULT_COUNTRY_CODE || '223')) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().replace(/[\s.\-()]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) {
    if (!/^\d+$/.test(s)) return null;
    s = s.length === 8 ? `+${countryCode}${s}` : s.startsWith(countryCode) ? `+${s}` : `+${s}`;
  }
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

module.exports = { normalizePhone };
