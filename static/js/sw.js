// NortFood - Service Worker v8 - Con Push Notifications + Share Target + Sound Messages
const CACHE_NAME = 'nortfood-v8';
const STATIC_ASSETS = [
    '/static/css/style.css',
    '/static/css/home.css',
    '/static/js/script.js',
    '/static/js/home.js',
    '/static/img/default_product.png',
    '/static/img/default_logo.png',
    '/static/img/icon-192x192.png'
];

// Rutas que NUNCA se cachean (siempre van a la red)
const NEVER_CACHE_PATTERNS = [
    '/panel',
    '/pedidos',
    '/superadmin',
    '/carrito',
    '/api/',
    '/cliente/',
    '/repartidor/',
    '/negocio/',
    '/orders/',
    '/chat/',
    '/editar-seccion',
    '/eliminar-seccion'
];

function shouldNeverCache(url) {
    return NEVER_CACHE_PATTERNS.some(pattern => url.pathname.startsWith(pattern));
}

// ============================================
// INSTALACIÓN
// ============================================
self.addEventListener('install', event => {
    console.log('[NortFood SW] Instalado v8');
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS).catch(err => {
                console.warn('[NortFood SW] Algunos assets no se pudieron pre-cachear:', err);
            });
        })
    );
});

// ============================================
// ACTIVACIÓN: limpiamos cachés viejas
// ============================================
self.addEventListener('activate', event => {
    console.log('[NortFood SW] Activado v8');
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        }).then(() => clients.claim())
    );
});

// ============================================
// FETCH: Único handler para todas las peticiones
// ============================================
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Cross-origin (Cloudinary, Google Fonts, etc.) → no interceptar
    if (url.origin !== self.location.origin) {
        return;
    }

    // SHARE TARGET: POST a /share-target
    if (url.pathname === '/share-target' && event.request.method === 'POST') {
        console.log('[NortFood SW] Share target recibido');
        event.respondWith(handleShareTarget(event));
        return;
    }

    // Solo interceptar GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Páginas dinámicas → SIEMPRE ir a la red primero (nunca cachear)
    if (shouldNeverCache(url) || event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(networkResponse => {
                    return networkResponse;
                })
                .catch(() => {
                    // Solo si no hay red, intentar caché como fallback
                    return caches.match(event.request).then(cachedResponse => {
                        return cachedResponse || caches.match('/');
                    });
                })
        );
        return;
    }

    // Archivos estáticos (.css, .js, .png, .jpg, etc.) → stale-while-revalidate
    const isStaticAsset = /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp)(\?|$)/i.test(url.pathname) 
        || url.pathname.startsWith('/static/');

    if (isStaticAsset) {
        event.respondWith(
            caches.match(event.request).then(cachedResponse => {
                if (cachedResponse) {
                    // Devolver caché y actualizar en background
                    const fetchPromise = fetch(event.request).then(networkResponse => {
                        if (networkResponse && networkResponse.status === 200) {
                            caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse.clone()));
                        }
                        return networkResponse;
                    }).catch(() => cachedResponse);
                    return cachedResponse;
                }
                return fetch(event.request).then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
                    }
                    return networkResponse;
                });
            })
        );
        return;
    }

    // Todo lo demás → network first
    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                return networkResponse;
            })
            .catch(() => {
                return caches.match(event.request).then(cachedResponse => {
                    return cachedResponse || new Response('Offline', { status: 503 });
                });
            })
    );
});

// ============================================
// SHARE TARGET - Manejo de archivos compartidos
// ============================================
async function handleShareTarget(event) {
    try {
        const formData = await event.request.formData();

        // Extraer datos del share
        const title = formData.get('title') || '';
        const text = formData.get('text') || '';
        const sharedUrl = formData.get('url') || '';
        const file = formData.get('archivo');

        let sharedData = {
            title,
            text,
            url: sharedUrl,
            fileName: null,
            fileType: null,
            fileData: null
        };

        // Si hay archivo (comprobante, imagen, PDF, etc.)
        if (file && file instanceof File) {
            sharedData.fileName = file.name;
            sharedData.fileType = file.type;

            // Convertir archivo a base64 para pasarlo a la app
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            sharedData.fileData = btoa(binary);

            console.log(`[NortFood SW] Archivo recibido: ${file.name} (${file.type}, ${file.size} bytes)`);
        }

        // Enviar datos a ventanas activas
        const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

        if (allClients.length > 0) {
            allClients[0].postMessage({
                type: 'SHARE_TARGET',
                data: sharedData
            });
            allClients[0].focus();
        }

        // Guardar en IndexedDB para recuperar después
        const dbPromise = openDB();
        await saveSharedData(dbPromise, sharedData);

        // Redirigir a la página que maneja el contenido compartido
        return Response.redirect('/share-target?shared=1', 303);
    } catch (err) {
        console.error('[NortFood SW] Error procesando share target:', err);
        return Response.redirect('/?share=error', 303);
    }
}

// ============================================
// PUSH NOTIFICATIONS
// ============================================

// Recibir notificación push del servidor
self.addEventListener('push', event => {
    console.log('[NortFood SW] Push recibido:', event);

    let data = {
        title: 'NortFood',
        body: 'Tienes una nueva notificación',
        icon: '/static/img/icon-192x192.png',
        badge: '/static/img/icon-72x72.png',
        url: '/',
        tag: 'nortfood-notification',
        requireInteraction: false,
        vibrate: [100, 50, 100],
        actions: [],
        sound: null
    };

    if (event.data) {
        try {
            const payload = event.data.json();
            data = { ...data, ...payload };
        } catch (e) {
            data.body = event.data.text();
        }
    }

    // Configurar sonido según tipo de notificación
    if (data.type === 'order_update') {
        if (data.newStatus === 'preparando') {
            data.sound = 'preparing';
        } else if (data.newStatus === 'en_camino') {
            data.sound = 'onTheWay';
        } else if (data.newStatus === 'listo_para_retirar') {
            data.sound = 'readyForPickup';
        }
    }

    // Notificar a las ventanas activas para que reproduzcan sonido
    if (data.sound) {
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            windowClients.forEach(client => {
                client.postMessage({
                    type: 'PLAY_SOUND',
                    sound: data.sound
                });
            });
        });
    }

    // Configurar acciones según tipo de notificación
    if (data.type === 'order_update') {
        data.actions = [
            { action: 'view_order', title: 'Ver Pedido' },
            { action: 'dismiss', title: 'Ignorar' }
        ];
        data.tag = `order-${data.orderId || 'unknown'}`;
        data.requireInteraction = true;
    } else if (data.type === 'new_order') {
        data.actions = [
            { action: 'view_order', title: 'Ver Pedido' },
            { action: 'dismiss', title: 'Ignorar' }
        ];
        data.tag = `new-order-${data.orderId || 'unknown'}`;
        data.requireInteraction = true;
        data.vibrate = [200, 100, 200, 100, 200];
    } else if (data.type === 'new_delivery') {
        data.actions = [
            { action: 'view_order', title: 'Ver Delivery' },
            { action: 'dismiss', title: 'Ignorar' }
        ];
        data.tag = `delivery-${data.orderId || 'unknown'}`;
        data.requireInteraction = true;
        data.vibrate = [200, 100, 200, 100, 200, 100, 200];
    } else if (data.type === 'delivery_confirmed') {
        data.actions = [
            { action: 'view_order', title: 'Marcar Entregado' },
            { action: 'dismiss', title: 'Ignorar' }
        ];
        data.tag = `confirmed-${data.orderId || 'unknown'}`;
        data.requireInteraction = true;
    } else if (data.type === 'delivery_cancelled') {
        data.actions = [
            { action: 'view_order', title: 'Ver Pedidos' },
            { action: 'dismiss', title: 'Ignorar' }
        ];
        data.tag = `delivery-cancelled-${data.orderId || 'unknown'}`;
    } else if (data.type === 'order_cancelled') {
        data.actions = [
            { action: 'view_order', title: 'Ver Pedidos' },
            { action: 'dismiss', title: 'Ignorar' }
        ];
        data.tag = `cancelled-${data.orderId || 'unknown'}`;
    } else if (data.type === 'new_message') {
        data.actions = [
            { action: 'view_chat', title: 'Ver Chat' },
            { action: 'dismiss', title: 'Ignorar' }
        ];
        data.tag = `chat-${data.chatId || 'unknown'}`;
    } else if (data.type === 'promotion') {
        data.actions = [
            { action: 'view_promo', title: 'Ver Oferta' },
            { action: 'dismiss', title: 'Ignorar' }
        ];
    }

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon,
            badge: data.badge,
            image: data.image || undefined,
            vibrate: data.vibrate,
            tag: data.tag,
            requireInteraction: data.requireInteraction,
            renotify: true,
            actions: data.actions,
            data: {
                url: data.url,
                type: data.type || 'general',
                orderId: data.orderId || null,
                chatId: data.chatId || null
            }
        })
    );
});

// Click en notificación
self.addEventListener('notificationclick', event => {
    console.log('[NortFood SW] Click en notificación:', event);

    event.notification.close();

    const notificationData = event.notification.data || {};
    let targetUrl = notificationData.url || '/';

    // Si clickeó una acción específica
    if (event.action) {
        switch (event.action) {
            case 'view_order':
                targetUrl = notificationData.orderId
                    ? `/orders/${notificationData.orderId}`
                    : '/orders';
                break;
            case 'view_chat':
                targetUrl = notificationData.chatId
                    ? `/chat/${notificationData.chatId}`
                    : '/chat';
                break;
            case 'view_promo':
                targetUrl = notificationData.url || '/promotions';
                break;
            case 'dismiss':
                return;
        }
    }

    // Abrir o enfocar la ventana existente
    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then(windowClients => {
            for (const client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

// ============================================
// SUSCRIPCIÓN PUSH CAMBIADA
// ============================================
self.addEventListener('pushsubscriptionchange', event => {
    console.log('[NortFood SW] Suscripción push cambió, re-suscribiendo...');

    event.waitUntil(
        self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: undefined
        }).then(newSubscription => {
            return fetch('/api/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    subscription: newSubscription,
                    oldEndpoint: event.oldSubscription ? event.oldSubscription.endpoint : null
                })
            });
        }).catch(err => {
            console.error('[NortFood SW] Error al re-suscribir:', err);
        })
    );
});

// ============================================
// IndexedDB para share target (persistencia)
// ============================================

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('NortFoodSharedData', 1);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('sharedItems')) {
                db.createObjectStore('sharedItems', { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function saveSharedData(dbPromise, data) {
    return dbPromise.then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sharedItems', 'readwrite');
            const store = tx.objectStore('sharedItems');
            const request = store.add({
                ...data,
                timestamp: Date.now()
            });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    });
}

// ============================================
// MENSAJES DESDE LA APP PRINCIPAL
// ============================================
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data && event.data.type === 'GET_SUBSCRIPTION') {
        self.registration.pushManager.getSubscription().then(sub => {
            event.source.postMessage({
                type: 'SUBSCRIPTION_RESULT',
                subscription: sub ? sub.toJSON() : null
            });
        });
    }
});
