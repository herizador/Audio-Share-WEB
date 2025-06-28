const CACHE_NAME = 'romantic-audio-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './audio-processor.js',
    './styles.css',
    './app.js',
    './manifest.json',
    './icons/icon-192x192.png',
    './icons/icon-512x512.png',
    './icons/apple-touch-icon.png'
];

// Instalación del Service Worker
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Cache abierto');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => self.skipWaiting()) // Forzar activación inmediata
    );
});

// Activación del Service Worker
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Eliminando cache antiguo:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Tomar control de clientes inmediatamente
    );
});

// Estrategia de cache: Network First, fallback to cache
self.addEventListener('fetch', (event) => {
    // No interceptar solicitudes de WebSocket
    if (event.request.url.startsWith('ws://') || event.request.url.startsWith('wss://')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Clonar la respuesta antes de cachearla
                const responseToCache = response.clone();
                
                // Solo cachear solicitudes exitosas
                if (response.status === 200) {
                    caches.open(CACHE_NAME)
                        .then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                }
                
                return response;
            })
            .catch(() => {
                // Si la red falla, intentar desde cache
                return caches.match(event.request)
                    .then((response) => {
                        if (response) {
                            return response;
                        }
                        // Si no está en cache, devolver una página de error offline
                        if (event.request.mode === 'navigate') {
                            return caches.match('./offline.html');
                        }
                        // Para otros recursos, devolver un error
                        return new Response('Sin conexión', {
                            status: 503,
                            statusText: 'Sin conexión'
                        });
                    });
            })
    );
});
