// Durcissement HTTP sans dépendance : en-têtes de sécurité, CORS explicite, limitation de débit en mémoire.

const config = require('../config');

// CSP stricte : tout est servi par le même serveur (aucun CDN). Les images de profil peuvent venir d'une URL https.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

// CORS : désactivé par défaut (application servie en same-origin). CORS_ORIGINS=https://a.example,https://b.example pour autoriser.
function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Tenant-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
}

const limiters = [];

// Fenêtre fixe, compteurs en mémoire (suffisant pour une instance unique ; à remplacer par Redis si plusieurs instances).
function rateLimit({ windowMs, max, keyFn, message }) {
  const hits = new Map();
  const limiter = (req, res, next) => {
    const now = Date.now();
    const key = keyFn ? keyFn(req) : req.ip || 'inconnu';
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (hits.size > 10000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: message || 'Trop de requêtes, réessayez plus tard.' });
    }
    return next();
  };
  limiter.reset = () => hits.clear();
  limiters.push(limiter);
  return limiter;
}

const resetRateLimits = () => limiters.forEach((l) => l.reset());

module.exports = { securityHeaders, cors, rateLimit, resetRateLimits };
