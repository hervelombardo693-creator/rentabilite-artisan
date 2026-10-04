// Fonctionnement hors connexion : à l'installation, le navigateur garde une copie de tous les fichiers de
// l'application ; ensuite elle s'ouvre depuis cette copie, avec ou sans réseau. Les données de l'utilisateur ne
// passent pas par ici (elles sont dans la mémoire du téléphone).
// VERSION et FICHIERS sont remplis par outils/construire_mobile.py : une nouvelle version remplace l'ancienne copie.
const VERSION = 'af1a8170';
const FICHIERS = ["./", "apilocale.js", "app.js", "calculs.js", "index.html", "manifest.webmanifest", "mobile.js", "style.css", "icone-180.png", "icone-192.png", "icone-512.png", "icone-pleine-512.png"];
const COPIE = 'rentabilite-' + VERSION;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(COPIE)
    .then(c => c.addAll(FICHIERS.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(noms => Promise.all(noms.filter(n => n.startsWith('rentabilite-') && n !== COPIE).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
