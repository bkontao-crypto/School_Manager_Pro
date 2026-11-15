// Service worker de SCHOOL MANAGER PRO.
// - Coquille de l'application (HTML, CSS, JS, polices, icônes) : mise en cache pour un démarrage hors ligne.
// - L'API (/api/*) n'est JAMAIS mise en cache : les données des élèves et les jetons ne doivent pas rester sur l'appareil.
// Changer VERSION à chaque livraison : l'ancien cache est supprimé à l'activation.
const VERSION = '2.22.0';
const CACHE = `smp-${VERSION}`;
const SHELL = [
  '/', '/app.js', '/manifest.json',
  '/styles/tailwind.css', '/styles/main.css', '/assets/fonts.css', '/assets/fontawesome.css',
  '/assets/fonts/inter-Regular.woff', '/assets/fonts/inter-Medium.woff', '/assets/fonts/inter-SemiBold.woff', '/assets/fonts/inter-Bold.woff', '/assets/fonts/inter-ExtraBold.woff',
  '/assets/webfonts/fa-solid-900.woff2', '/assets/webfonts/fa-regular-400.woff2',
  '/assets/img/avatar.svg', '/assets/img/banner-default.svg',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('smp-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return; // réseau uniquement

  if (req.mode === 'navigate') { // pages : réseau d'abord, coquille en cache si hors ligne
    event.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  event.respondWith( // fichiers statiques : cache d'abord, mise à jour en arrière-plan
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
