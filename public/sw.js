// ============================================
// DeliGO - Service Worker for Push Notifications
// ============================================

// Listen for push events
self.addEventListener("push", (event) => {
  let data = {
    title: "DeliGO",
    body: "Tenés una nueva notificación",
    icon: "/icon-192x192.png",
    badge: "/icon-192x192.png",
    tag: "default",
    data: {},
    actions: [],
    requireInteraction: false,
    silent: false,
  }

  if (event.data) {
    try {
      const parsed = event.data.json()
      data = { ...data, ...parsed }
    } catch {
      data.body = event.data.text() || data.body
    }
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    tag: data.tag,
    data: data.data,
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false,
    silent: data.silent || false,
    vibrate: data.silent ? undefined : [100, 50, 100],
  }

  event.waitUntil(self.registration.showNotification(data.title, options))
})

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const notificationData = event.notification.data || {}
  const action = event.action

  // Determine URL based on notification type
  let targetUrl = "/"

  if (notificationData.url) {
    targetUrl = notificationData.url
  } else if (notificationData.type === "order_update" && notificationData.pedidoId) {
    targetUrl = "/?tab=pedidos"
  } else if (notificationData.type === "new_order" && notificationData.pedidoId) {
    targetUrl = "/" // Business panel shows orders
  } else if (notificationData.type === "new_delivery" && notificationData.pedidoId) {
    targetUrl = "/" // Repartidor panel
  } else if (notificationData.type === "review") {
    targetUrl = "/" // Business reviews tab
  } else if (notificationData.type === "chat" && notificationData.pedidoId) {
    targetUrl = "/" // Chat is accessible from home
  }

  // Handle action buttons
  if (action === "view") {
    targetUrl = notificationData.url || targetUrl
  } else if (action === "navigate" && notificationData.pedidoId) {
    // For delivery navigation, could open maps in the future
    targetUrl = "/"
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      // Open new window
      return self.clients.openWindow(targetUrl)
    })
  )
})

// Handle push subscription change
self.addEventListener("pushsubscriptionchange", (event) => {
  // The subscription expired or was invalidated
  // The app should re-subscribe automatically via the usePushNotifications hook
  console.log("[SW] Push subscription changed, app needs to re-subscribe")
})

// Handle SKIP_WAITING message from the app
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
})

// Fetch event - network first strategy for API, cache first for static assets
self.addEventListener("fetch", (event) => {
  // Only handle GET requests
  if (event.request.method !== "GET") return

  const url = new URL(event.request.url)

  // Skip cross-origin requests except for fonts/CDN
  if (url.origin !== self.location.origin) return

  // Skip API calls and Next.js internal routes
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/") ||
    url.pathname.includes("socket.io")
  ) {
    return
  }

  // For static assets, use cache-first
  if (
    url.pathname.match(/\.(png|jpg|jpeg|svg|ico|webp|woff2?|css|js)$/) ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open("deligo-v1").then((cache) => {
              cache.put(event.request, clone)
            })
          }
          return response
        })
      })
    )
  }
})

// Install event - pre-cache critical assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("deligo-v1").then((cache) => {
      return cache.addAll([
        "/",
        "/manifest.json",
        "/icon-192x192.png",
        "/icon-512x512.png",
        "/icon.svg",
        "/favicon.ico",
      ]).catch(() => {
        // Silently fail - assets might not be available in dev
      })
    })
  )
  self.skipWaiting()
})

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== "deligo-v1")
          .map((name) => caches.delete(name))
      )
    }).then(() => self.clients.claim())
  )
})
