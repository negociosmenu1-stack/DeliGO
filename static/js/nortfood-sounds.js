/* =========================================
   NORTFOOD - SISTEMA DE SONIDOS
   Usa Web Audio API para generar sonidos
   sintetizados (sin archivos externos)
   ========================================= */

const NortSounds = {
    _ctx: null,
    _enabled: true,

    // Obtener o crear AudioContext (lazy init)
    _getContext() {
        if (!this._ctx) {
            this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        // Reanudar si fue suspendido (política de autoplay)
        if (this._ctx.state === 'suspended') {
            this._ctx.resume();
        }
        return this._ctx;
    },

    // Verificar si los sonidos están habilitados
    isEnabled() {
        // Respetar preferencia del usuario
        try {
            const pref = localStorage.getItem('nortfood_sounds');
            if (pref === 'off') return false;
        } catch(e) {}
        return this._enabled;
    },

    // Activar/desactivar sonidos
    toggle() {
        this._enabled = !this._enabled;
        try {
            localStorage.setItem('nortfood_sounds', this._enabled ? 'on' : 'off');
        } catch(e) {}
        return this._enabled;
    },

    // ---- SONIDO: Pedido realizado (cha-ching feliz) ----
    // Dos notas ascendentes tipo "caja registradora"
    orderSuccess() {
        if (!this.isEnabled()) return;
        const ctx = this._getContext();
        const now = ctx.currentTime;

        // Nota 1: Do agudo
        this._playTone(ctx, 523.25, now, 0.15, 'sine', 0.25);
        // Nota 2: Mi agudo
        this._playTone(ctx, 659.25, now + 0.12, 0.15, 'sine', 0.25);
        // Nota 3: Sol agudo
        this._playTone(ctx, 783.99, now + 0.24, 0.2, 'sine', 0.3);
        // Nota 4: Do superior (resolución feliz)
        this._playTone(ctx, 1046.50, now + 0.40, 0.35, 'sine', 0.2);
    },

    // ---- SONIDO: Pedido en preparación ----
    // Un "ding" suave tipo campanita
    preparing() {
        if (!this.isEnabled()) return;
        const ctx = this._getContext();
        const now = ctx.currentTime;

        // Campanita suave con armónicos
        this._playTone(ctx, 880, now, 0.3, 'sine', 0.2);
        this._playTone(ctx, 1320, now, 0.25, 'sine', 0.08);
        this._playTone(ctx, 1760, now, 0.2, 'sine', 0.04);
    },

    // ---- SONIDO: Pedido en camino ----
    // Dos toques tipo "mensaje incoming" - urgente pero agradable
    onTheWay() {
        if (!this.isEnabled()) return;
        const ctx = this._getContext();
        const now = ctx.currentTime;

        // Ding-ding (doble campana)
        this._playTone(ctx, 784, now, 0.15, 'sine', 0.25);
        this._playTone(ctx, 988, now + 0.18, 0.25, 'sine', 0.3);
    },

    // ---- SONIDO: Notificación genérica ----
    notification() {
        if (!this.isEnabled()) return;
        const ctx = this._getContext();
        const now = ctx.currentTime;

        this._playTone(ctx, 660, now, 0.12, 'sine', 0.18);
        this._playTone(ctx, 880, now + 0.12, 0.18, 'sine', 0.22);
    },

    // ---- SONIDO: Listo para retirar ----
    // Tres notas ascendentes tipo "aviso"
    readyForPickup() {
        if (!this.isEnabled()) return;
        const ctx = this._getContext();
        const now = ctx.currentTime;

        this._playTone(ctx, 523.25, now, 0.12, 'sine', 0.2);
        this._playTone(ctx, 659.25, now + 0.13, 0.12, 'sine', 0.22);
        this._playTone(ctx, 783.99, now + 0.26, 0.2, 'sine', 0.28);
    },

    // ============================================
    // UTILIDADES INTERNAS
    // ============================================

    // Tocar una nota con envelope ADSR simplificado
    _playTone(ctx, frequency, startTime, duration, type, volume) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(frequency, startTime);

        // Envelope: ataque rápido, sustain suave, release
        const attack = 0.01;
        const release = Math.min(duration * 0.4, 0.1);
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(volume, startTime + attack);
        gain.gain.setValueAtTime(volume, startTime + duration - release);
        gain.gain.linearRampToValueAtTime(0, startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + duration + 0.05);
    }
};

// Hacer disponible globalmente
window.NortSounds = NortSounds;
