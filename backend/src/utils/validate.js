// Validation des entrées : un schéma par route, messages en français, valeurs normalisées en sortie.
//
// Règles de présence :
//  - champ absent  : erreur s'il est `required` (sauf mise à jour partielle), sinon valeur `default` si définie ;
//  - null ou "" fourni : devient NULL si `nullable`, erreur si `required`, sinon traité comme absent.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function checkOne(name, rule, raw) {
  const err = (message) => ({ error: { field: name, message } });
  const type = rule.type || 'string';

  if (type === 'string' || type === 'text') {
    if (typeof raw !== 'string') return err('Doit être un texte');
    const v = rule.noTrim ? raw : raw.trim();
    const max = rule.max || (type === 'text' ? 2000 : 255);
    if (v.length > max) return err(`${max} caractères maximum`);
    if (rule.min && v.length < rule.min) return err(`${rule.min} caractères minimum`);
    if (rule.pattern && !rule.pattern.test(v)) return err(rule.patternMessage || 'Format invalide');
    return { value: v };
  }
  if (type === 'uuid') {
    return isUuid(raw) ? { value: raw.toLowerCase() } : err('Identifiant invalide');
  }
  if (type === 'int' || type === 'number') {
    if (typeof raw !== 'number' && typeof raw !== 'string') return err('Doit être un nombre');
    const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : raw;
    if (!Number.isFinite(n)) return err('Doit être un nombre');
    if (type === 'int' && !Number.isInteger(n)) return err('Doit être un nombre entier');
    if (rule.min !== undefined && n < rule.min) return err(`Doit être supérieur ou égal à ${rule.min}`);
    if (rule.exclusiveMin !== undefined && n <= rule.exclusiveMin) return err(`Doit être supérieur à ${rule.exclusiveMin}`);
    if (rule.max !== undefined && n > rule.max) return err(`Doit être inférieur ou égal à ${rule.max}`);
    return { value: n };
  }
  if (type === 'date') {
    return typeof raw === 'string' && isRealDate(raw.trim()) ? { value: raw.trim() } : err('Date invalide (format AAAA-MM-JJ)');
  }
  if (type === 'time') {
    const m = typeof raw === 'string' ? raw.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/) : null;
    return m ? { value: `${m[1]}:${m[2]}` } : err('Heure invalide (format HH:MM)');
  }
  if (type === 'enum') {
    return rule.values.includes(raw) ? { value: raw } : err(`Valeur autorisée : ${rule.values.join(', ')}`);
  }
  if (type === 'url') {
    if (typeof raw !== 'string' || raw.length > 500) return err('URL invalide');
    try {
      const u = new URL(raw.trim());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return err('Seules les URL http et https sont acceptées');
      return { value: u.toString() };
    } catch (e) {
      return err('URL invalide');
    }
  }
  if (type === 'boolean') {
    return typeof raw === 'boolean' ? { value: raw } : err('Doit être vrai ou faux');
  }
  if (type === 'stringArray') {
    if (!Array.isArray(raw)) return err('Doit être une liste');
    if (raw.length > (rule.maxItems || 50)) return err(`${rule.maxItems || 50} éléments maximum`);
    const out = [];
    for (const item of raw) {
      if (typeof item !== 'string' || item.trim().length === 0 || item.length > (rule.itemMax || 100)) {
        return err('Chaque élément doit être un texte non vide');
      }
      out.push(item.trim());
    }
    return { value: out };
  }
  throw new Error(`Type de validation inconnu : ${type}`);
}

function validate(input, spec, { partial = false } = {}) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const values = {};
  const errors = [];

  for (const [name, rule] of Object.entries(spec)) {
    const raw = body[name];
    const absent = raw === undefined;
    const blank = raw === null || (typeof raw === 'string' && raw.trim() === '');

    if (absent || blank) {
      if (blank && rule.nullable) { values[name] = null; continue; }
      if (rule.required && (!absent || !partial)) { errors.push({ field: name, message: 'Champ obligatoire' }); continue; }
      if (rule.default !== undefined && !partial) values[name] = rule.default;
      continue;
    }
    const res = checkOne(name, rule, raw);
    if (res.error) errors.push(res.error); else values[name] = res.value;
  }
  return { values, errors };
}

module.exports = { validate, isUuid, isRealDate };
