// NortFood - Push Notification Helper para Flask
// Este archivo se incluye en home.html
// <script src="{{ url_for('static', filename='js/push-helper.js', v=v) }}"></script>

const NortFoodPush = {
    // Las rutas coinciden con las del servidor Flask (app.py)
    API_VAPID_KEY: '/api/push/vapid-key',
    API_CLIENTE_SUBSCRIBE: '/api/cliente/push/subscribe',
    API_CLIENTE_UNSUBSCRIBE: '/api/cliente/push/unsubscribe',

    // ============================================
    // OBTENER VAPID KEY DEL SERVIDOR
    // ============================================
    async getVapidKey() {
        try {
            const res = await fetch(this.API_VAPID_KEY);
            if (res.ok) {
                const data = await res.json();
                return data.publicKey;
            }
        } catch (e) {
            console.warn('[NortFood Push] Error obteniendo VAPID key:', e);
        }
        return null;
    },

    // ============================================
    // SUSCRIBIR CLIENTE A PUSH
    // ============================================
    async subscribe() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.warn('[NortFood Push] Push API no disponible');
            return null;
        }

        try {
            const vapidKey = await this.getVapidKey();
            if (!vapidKey) {
                console.error('[NortFood Push] No hay VAPID key');
                return null;
            }

            const registration = await navigator.serviceWorker.ready;
            let subscription = await registration.pushManager.getSubscription();

            // Si existe suscripción vieja, desuscribir y crear nueva
            // (necesario cuando cambian las VAPID keys)
            if (subscription) {
                console.log('[NortFood Push] Desuscribiendo suscripción vieja...');
                await subscription.unsubscribe();
                subscription = null;
                // Limpiar en servidor también
                await fetch('/api/push/clear-old-subs', { method: 'POST' }).catch(() => {});
            }

            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.warn('[NortFood Push] Permiso denegado');
                return null;
            }

            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: this.urlBase64ToUint8Array(vapidKey)
            });

            // Enviar al servidor Flask
            const res = await fetch(this.API_CLIENTE_SUBSCRIBE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: subscription.toJSON() })
            });

            if (res.ok) {
                console.log('[NortFood Push] Cliente suscrito');
                return subscription;
            }
            return null;
        } catch (err) {
            console.error('[NortFood Push] Error:', err);
            return null;
        }
    },

    // ============================================
    // DESUSCRIBIR CLIENTE
    // ============================================
    async unsubscribe() {
        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            if (subscription) {
                await subscription.unsubscribe();
                await fetch(this.API_CLIENTE_UNSUBSCRIBE, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: subscription.endpoint })
                });
                console.log('[NortFood Push] Desuscrito');
            }
        } catch (err) {
            console.error('[NortFood Push] Error al desuscribir:', err);
        }
    },

    // ============================================
    // VERIFICAR SI ESTÁ SUSCRITO
    // ============================================
    async isSubscribed() {
        try {
            const registration = await navigator.serviceWorker.ready;
            const sub = await registration.pushManager.getSubscription();
            return sub !== null;
        } catch {
            return false;
        }
    },

    // ============================================
    // UTILIDAD: VAPID key base64 → Uint8Array
    // ============================================
    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }
};
