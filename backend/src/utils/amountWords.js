// Montant en lettres, en français (reçus). Orthographe : « quatre-vingts » prend un s seulement en fin de nombre,
// « cent » aussi (deux cents / deux cent un), « mille » est invariable, « million » et « milliard » s'accordent.

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function below100(n, final) {
  if (n < 17) return UNITS[n];
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  if (n < 70) { const t = Math.floor(n / 10); const u = n % 10; return u === 0 ? TENS[t] : u === 1 ? `${TENS[t]} et un` : `${TENS[t]}-${UNITS[u]}`; }
  if (n < 80) { const u = n - 60; return u === 11 ? 'soixante et onze' : `soixante-${below100(u, final)}`; }
  if (n === 80) return final ? 'quatre-vingts' : 'quatre-vingt';
  return `quatre-vingt-${below100(n - 80, final)}`;
}
function below1000(n, final) {
  const h = Math.floor(n / 100); const r = n % 100;
  if (h === 0) return below100(r, final);
  const head = h === 1 ? 'cent' : `${UNITS[h]} cent${r === 0 && final ? 's' : ''}`;
  return r === 0 ? head : `${head} ${below100(r, final)}`;
}

function amountInWords(value) {
  let n = Math.floor(Math.abs(Number(value)));
  if (!Number.isFinite(n) || n > 999999999999) return '';
  if (n === 0) return 'zéro';
  const groups = [[1e9, 'milliard'], [1e6, 'million']]; const out = [];
  for (const [size, name] of groups) {
    const q = Math.floor(n / size); n %= size;
    if (q) out.push(`${below1000(q, false)} ${name}${q > 1 ? 's' : ''}`);
  }
  const th = Math.floor(n / 1000); n %= 1000;
  if (th) out.push(th === 1 ? 'mille' : `${below1000(th, false)} mille`);
  if (n) out.push(below1000(n, true));
  return out.join(' ');
}

module.exports = { amountInWords };
