// SCHOOL MANAGER PRO — point d'entrée du serveur.
// createApp() construit l'application (réutilisée telle quelle par les tests) ; le serveur ne démarre que si ce fichier est lancé directement.

const express = require('express');
const path = require('path');
const config = require('./config');
const db = require('./utils/db');
const { authenticate, requireAuth, requireActiveAccount, requireSuperAdmin, requireTenant } = require('./middleware/auth');
const { gateRead } = require('./utils/permissions');
const { enforceQuota } = require('./middleware/quota');
const { securityHeaders, cors, rateLimit } = require('./middleware/security');
const { errorHandler, apiNotFound } = require('./utils/http');

const FRONTEND_DIR = path.join(__dirname, '../../frontend');
const PWA_DIR = path.join(__dirname, '../../pwa');

function buildApi() {
  const api = express.Router();
  api.use(rateLimit({ windowMs: 60 * 1000, max: config.rateLimitApiPerMinute }));

  // Public : sonde de disponibilité (aucune donnée métier)
  api.get('/health', async (req, res) => {
    let database = true;
    try { await db.query('SELECT 1'); } catch (e) { database = false; }
    res.status(database ? 200 : 503).json({ status: database ? 'ok' : 'degraded', service: 'SCHOOL MANAGER PRO', version: config.version, database });
  });

  // Public : identité de la plateforme (nom, slogan, logo) pour la page de connexion.
  api.use('/identity', require('./modules/identity').publicRouter);

  api.use(authenticate);
  api.use('/auth', require('./modules/auth')); // /login public ; /me protégé dans le module

  // Tout ce qui suit exige un jeton valide.
  api.use(requireAuth);
  api.use(requireActiveAccount);

  // Espace superadmin : établissements, packs, licences, quotas. Aucune donnée privée d'établissement.
  const platformRouter = express.Router();
  platformRouter.use(requireSuperAdmin);
  platformRouter.use('/identity', require('./modules/identity').platformEdit);
  platformRouter.use(require('./modules/platformMail'));
  platformRouter.use(require('./modules/platform'));
  api.use('/platform', platformRouter);

  // Routes métier : l'établissement vient uniquement du jeton ; le superadmin n'y a pas accès.
  const scoped = express.Router();
  scoped.use(requireTenant);
  // Cloisonnement du portail parent : un compte « parent » n'atteint que /portal et la lecture des paramètres d'affichage.
  scoped.use((req, res, next) => {
    if (req.user && req.user.role === 'parent') {
      const ok = req.path.startsWith('/portal') || (req.method === 'GET' && req.path.startsWith('/settings'));
      if (!ok) return res.status(403).json({ error: 'Accès réservé au portail parent.', code: 'parent_portal_only' });
    }
    next();
  });
  scoped.post('/students', enforceQuota('students'));
  scoped.post('/users', enforceQuota('users'));
  scoped.use('/broadcasts', gateRead('notifications'), require('./modules/broadcasts'));
  scoped.use('/portal', require('./modules/portal'));
  scoped.use('/parents', require('./modules/parents'));
  scoped.use('/students', gateRead('students'), require('./modules/students'));
  scoped.use('/classes', gateRead('classes'), require('./modules/classes'));
  scoped.use('/teachers', gateRead('teachers'), require('./modules/teachers'));
  scoped.use('/attendances', gateRead('attendances'), require('./modules/attendances'));
  scoped.use('/grades', gateRead('grades'), require('./modules/grades'));
  scoped.use('/payments', gateRead('payments'), require('./modules/payments'));
  scoped.use('/messages', gateRead('messages'), require('./modules/messages'));
  scoped.use('/documents', gateRead('documents'), require('./modules/documents'));
  scoped.use('/stocks', gateRead('stocks'), require('./modules/stocks'));
  scoped.use('/notifications', gateRead('notifications'), require('./modules/notifications'));
  scoped.use('/hr', gateRead('hr'), require('./modules/hr'));
  scoped.use('/stats', require('./modules/stats'));
  scoped.use('/library', gateRead('library'), require('./modules/library'));
  scoped.use('/canteen', gateRead('canteen'), require('./modules/canteen'));
  scoped.use('/transport', gateRead('transport'), require('./modules/transport'));
  scoped.use('/periods', gateRead('periods'), require('./modules/periods'));
  scoped.use('/timetable', gateRead('timetable'), require('./modules/timetable'));
  scoped.use('/reports', gateRead('reports'), require('./modules/reports'));
  const accounts = require('./modules/settings');
  scoped.use('/settings', accounts.settings);
  scoped.use('/users', accounts.users);
  api.use(scoped);

  api.use(apiNotFound); // toute route /api inconnue répond en JSON 404 (jamais la page HTML)
  return api;
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(cors);
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', buildApi());

  // Fichiers statiques : interface, puis manifeste PWA et service worker servis à la racine (portée « / »).
  app.use(express.static(FRONTEND_DIR));
  app.use(express.static(PWA_DIR));

  // Repli vers l'application pour les pages (pas pour les fichiers : un .js ou .png manquant doit répondre 404).
  app.get('*', (req, res) => {
    if (path.extname(req.path)) return res.status(404).type('text/plain').send('Fichier introuvable');
    return res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`SCHOOL MANAGER PRO v${config.version} démarré sur le port ${config.port}`);
  });
  require('./utils/reminders').startScheduler();

  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} reçu : arrêt en cours…`);
    server.close(() => db.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = { createApp };
