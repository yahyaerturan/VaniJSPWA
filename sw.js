// sw.js - Production Ready Service Worker for VaniJS PWA
const VERSION = new URL(self.location.href).searchParams.get('ver') || '2.0.0';
const CACHE_NAME   = `vanijs-pwa-v${VERSION}`;
const DYNAMIC_CACHE= `vanijs-dynamic-v${VERSION}`;
const STATIC_CACHE = `vanijs-static-v${VERSION}`;
const API_CACHE    = `vanijs-api-v${VERSION}`;

// Core files to cache immediately
const CORE_FILES = [
    '/',
    '/index.html',
    '/manifest.json'
];

// Static assets to cache
const STATIC_ASSETS = [
    // '/css/main.css',
    // '/css/components.css',
    // '/js/vendor.js',
    // '/images/logo.png',
    // '/images/hero-bg.jpg',
    // '/fonts/roboto.woff2',
    // '/icons/icon-192x192.png',
    // '/icons/icon-512x512.png',
    // '/icons/apple-touch-icon.png'
];

// API endpoints to cache (read-only)
const API_ENDPOINTS = [
    '/api/config',
    '/api/translations',
    '/api/products',
    '/api/categories'
];

// Install event - cache core assets
self.addEventListener('install', (event) => {
    console.log('🚀 Service Worker installing...');
    
    event.waitUntil(
        (async () => {
            try {
                // Open caches
                const staticCache = await caches.open(STATIC_CACHE);
                const coreCache = await caches.open(CACHE_NAME);
                
                // Cache core files
                console.log('📦 Caching core files...');
                await coreCache.addAll(CORE_FILES);
                
                // Cache static assets
                console.log('📦 Caching static assets...');
                await staticCache.addAll(STATIC_ASSETS);
                
                // Skip waiting to activate immediately
                await self.skipWaiting();
                console.log('✅ Service Worker installed successfully');
            } catch (error) {
                console.error('❌ Cache installation failed:', error);
                throw error;
            }
        })()
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('🔧 Service Worker activating...');
    
    event.waitUntil(
        (async () => {
            try {
                // Clean old caches
                const cacheNames = await caches.keys();
                await Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME && 
                            cacheName !== STATIC_CACHE && 
                            cacheName !== DYNAMIC_CACHE &&
                            cacheName !== API_CACHE) {
                            console.log('🗑️ Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
                
                // Claim clients
                await self.clients.claim();
                console.log('✅ Service Worker activated successfully');
                
                // Send message to all clients
                const clients = await self.clients.matchAll();
                clients.forEach(client => {
                    client.postMessage({
                        type: 'SW_ACTIVATED',
                        version: '2.0.0',
                        timestamp: Date.now()
                    });
                });
            } catch (error) {
                console.error('❌ Activation failed:', error);
                throw error;
            }
        })()
    );
});

// Fetch event - intelligent caching strategy
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Skip non-GET requests and external URLs
    if (request.method !== 'GET' || 
        !url.origin.startsWith(self.location.origin)) {
        return;
    }
    
    // Handle different types of requests
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(handleApiRequest(request));
    } else if (isStaticAsset(request)) {
        event.respondWith(handleStaticRequest(request));
    } else if (request.headers.get('Accept').includes('text/html')) {
        event.respondWith(handleHtmlRequest(request));
    } else {
        event.respondWith(handleDefaultRequest(request));
    }
});

// API request handling - Network first, cache fallback
async function handleApiRequest(request) {
    const url = new URL(request.url);
    const cache = await caches.open(API_CACHE);
    
    try {
        // Try network first
        const networkResponse = await fetch(request);
        
        // Cache successful GET responses
        if (networkResponse.ok && request.method === 'GET') {
            const clone = networkResponse.clone();
            caches.open(API_CACHE).then(cache => cache.put(request, clone));
        }
        
        return networkResponse;
    } catch (error) {
        // Fallback to cache
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Return offline response for API calls
        return new Response(
            JSON.stringify({ 
                error: 'Network unavailable', 
                offline: true,
                timestamp: Date.now() 
            }),
            { 
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

// Static asset handling - Cache first, network fallback
async function handleStaticRequest(request) {
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
        // Update cache in background
        fetch(request).then(networkResponse => {
            if (networkResponse.ok) {
                cache.put(request, networkResponse.clone());
            }
        });
        
        return cachedResponse;
    }
    
    // Fallback to network
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (error) {
        return offlineResponse(request);
    }
}

// HTML request handling - Network first, cache fallback
async function handleHtmlRequest(request) {
    try {
        // Try network first for HTML
        const networkResponse = await fetch(request);
        const cache = await caches.open(DYNAMIC_CACHE);
        
        // Cache the response
        cache.put(request, networkResponse.clone());
        
        return networkResponse;
    } catch (error) {
        // Fallback to cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Fallback to offline page
        return caches.match('/offline.html');
    }
}

// Default request handling
async function handleDefaultRequest(request) {
    try {
        const response = await fetch(request);
        return response;
    } catch (error) {
        return offlineResponse(request);
    }
}

// Offline response generator
function offlineResponse(request) {
    if (request.headers.get('Accept').includes('text/html')) {
        return caches.match('/offline.html')
            .then(response => response || createOfflinePage());
    }
    
    if (request.headers.get('Accept').includes('application/json')) {
        return new Response(
            JSON.stringify({ error: 'Offline', offline: true }),
            { 
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
    
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

// Create offline page dynamically
function createOfflinePage() {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Offline - VaniJS App</title>
            <style>
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                    padding: 2rem;
                    text-align: center;
                    background: #f5f5f5;
                }
                .container { 
                    max-width: 500px;
                    margin: 2rem auto;
                    padding: 2rem;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                h1 { color: #666; }
                button { 
                    background: #007bff;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 16px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>📶 Offline</h1>
                <p>You're currently offline. Please check your internet connection.</p>
                <button onclick="window.location.reload()">Retry Connection</button>
            </div>
        </body>
        </html>
    `;
    
    return new Response(html, {
        headers: { 'Content-Type': 'text/html' }
    });
}

// Helper function to check if request is for static asset
function isStaticAsset(request) {
    const staticExtensions = [
        /\.css$/,
        /\.js$/,
        /\.png$/,
        /\.jpg$/,
        /\.jpeg$/,
        /\.gif$/,
        /\.webp$/,
        /\.svg$/,
        /\.woff2$/,
        /\.ttf$/,
        /\.eot$/
    ];
    
    return staticExtensions.some(ext => ext.test(request.url));
}

// Background sync for failed requests
self.addEventListener('sync', (event) => {
    if (event.tag === 'background-sync') {
        console.log('🔄 Background sync triggered');
        event.waitUntil(doBackgroundSync());
    }
});

async function doBackgroundSync() {
    try {
        // Get failed requests from IndexedDB
        const failedRequests = await getFailedRequests();
        
        for (const failedRequest of failedRequests) {
            try {
                const response = await fetch(failedRequest.url, failedRequest.options);
                if (response.ok) {
                    await removeFailedRequest(failedRequest.id);
                    console.log('✅ Synced failed request:', failedRequest.url);
                }
            } catch (error) {
                console.error('❌ Background sync failed for:', failedRequest.url, error);
            }
        }
    } catch (error) {
        console.error('❌ Background sync error:', error);
    }
}

// Push notifications
self.addEventListener('push', (event) => {
    if (event.data) {
        const data = event.data.json();
        const options = {
            body: data.body,
            icon: '/icons/icon-192x192.png',
            badge: '/icons/icon-72x72.png',
            vibrate: [200, 100, 200],
            tag: 'vanijs-notification',
            data: {
                url: data.url || '/',
                action: data.action
            }
        };

        event.waitUntil(
            self.registration.showNotification(data.title, options)
        );
    }
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    if (event.notification.data && event.notification.data.url) {
        event.waitUntil(
            clients.openWindow(event.notification.data.url)
        );
    }
});

// Message handling from main app
self.addEventListener('message', (event) => {
    const { data } = event;
    
    switch (data.type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
            
        case 'CACHE_URLS':
            event.waitUntil(
                caches.open(STATIC_CACHE).then(cache => {
                    return cache.addAll(data.urls);
                })
            );
            break;
            
        case 'CLEAR_CACHE':
            caches.keys().then(cacheNames => {
                cacheNames.forEach(cacheName => caches.delete(cacheName));
            });
            break;
            
        case 'GET_CACHE_INFO':
            event.ports[0].postMessage({
                type: 'CACHE_INFO',
                caches: Array.from(caches.keys())
            });
            break;
    }
});

// Helper functions for background sync (simplified)
async function getFailedRequests() {
    // In a real implementation, you'd use IndexedDB
    return [];
}

async function removeFailedRequest(id) {
    // In a real implementation, you'd use IndexedDB
}

// Periodic sync (if supported)
if ('periodicSync' in self.registration) {
    self.addEventListener('periodicsync', (event) => {
        if (event.tag === 'content-update') {
            console.log('🔄 Periodic content update sync');
            event.waitUntil(updateContent());
        }
    });
}

async function updateContent() {
    try {
        // Update API data in background
        const cache = await caches.open(API_CACHE);
        const urlsToUpdate = [
            '/api/products',
            '/api/categories',
            '/api/config'
        ];

        for (const url of urlsToUpdate) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    await cache.put(url, response);
                    console.log('✅ Updated cached content:', url);
                }
            } catch (error) {
                console.error('❌ Failed to update content:', url, error);
            }
        }
    } catch (error) {
        console.error('❌ Periodic sync error:', error);
    }
}

// Cache management API
self.addEventListener('message', (event) => {
    const { data } = event;
    
    switch (data.type) {
        case 'GET_CACHE_STATS':
            event.waitUntil(getCacheStats().then(stats => {
                event.ports[0].postMessage({
                    type: 'CACHE_STATS',
                    stats
                });
            }));
            break;
            
        case 'CLEAR_CACHE_BY_TYPE':
            event.waitUntil(clearCacheByType(data.cacheType));
            break;
            
        case 'PRELOAD_RESOURCES':
            event.waitUntil(preloadResources(data.urls));
            break;
    }
});

async function getCacheStats() {
    const cacheNames = await caches.keys();
    const stats = {};
    
    for (const cacheName of cacheNames) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        stats[cacheName] = {
            size: requests.length,
            urls: requests.map(req => req.url)
        };
    }
    
    return stats;
}

async function clearCacheByType(cacheType) {
    const cacheNames = await caches.keys();
    const cachesToDelete = cacheNames.filter(name => name.includes(cacheType));
    
    await Promise.all(
        cachesToDelete.map(name => caches.delete(name))
    );
    
    return cachesToDelete;
}

async function preloadResources(urls) {
    const cache = await caches.open(STATIC_CACHE);
    const results = [];
    
    for (const url of urls) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                await cache.put(url, response.clone());
                results.push({ url, status: 'cached' });
            }
        } catch (error) {
            results.push({ url, status: 'failed', error: error.message });
        }
    }
    
    return results;
}

// Error reporting to main app
function reportErrorToClient(error, context = {}) {
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({
                type: 'SW_ERROR',
                error: {
                    message: error.message,
                    stack: error.stack,
                    timestamp: Date.now(),
                    ...context
                }
            });
        });
    });
}

// Health check - ensure SW is functioning
setInterval(async () => {
    try {
        // Simple health check - try to access cache
        const cache = await caches.open(CACHE_NAME);
        await cache.keys();
    } catch (error) {
        console.error('❌ Service Worker health check failed:', error);
        reportErrorToClient(error, { type: 'health_check' });
    }
}, 30000); // Check every 30 seconds

console.log('✅ Service Worker loaded successfully');