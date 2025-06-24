const CACHE_NAME = 'romantic-audio-v1';
const urlsToCache = ['./']; // Asegúrate de que esta URL sea correcta para tu raíz

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker instalando, cacheando URLs...');
                return cache.addAll(urlsToCache);
            })
            .catch(error => {
                console.error('Fallo al cachear URLs en la instalación:', error);
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});

// Opcional: `activate` event para limpiar cachés antiguas
self.addEventListener('activate', event => {
    console.log('Service Worker activado');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Service Worker: Eliminando caché antigua:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
