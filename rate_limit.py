"""
Rate limiting system (in-memory).
"""
import time as _time
from functools import wraps

from flask import request, session, jsonify, flash, redirect, current_app


_rate_limit_store = {}  # {key: [timestamp1, timestamp2, ...]}

RATE_LIMITS = {
    'login_cliente':       (5, 300),    # 5 intentos cada 5 min
    'login_negocio':       (5, 300),
    'login_repartidor':    (5, 300),
    'login_superadmin':    (5, 300),
    'registro_cliente':    (3, 3600),   # 3 registros por hora
    'registro_negocio':    (3, 3600),
    'registro_repartidor': (3, 3600),
    'chat_enviar':         (30, 60),    # 30 mensajes por minuto
    'crear_resena':        (3, 300),    # 3 reseñas cada 5 min
    'crear_pedido':        (5, 300),    # 5 pedidos cada 5 min (backup del de MongoDB)
}

_last_rate_cleanup = _time.time()


def _check_rate_limit(key, max_requests, window_seconds):
    """Verifica rate limit. Devuelve True si se permite, False si se excedió."""
    now = _time.time()
    if key not in _rate_limit_store:
        _rate_limit_store[key] = []
    _rate_limit_store[key] = [ts for ts in _rate_limit_store[key] if now - ts < window_seconds]
    if len(_rate_limit_store[key]) >= max_requests:
        return False
    _rate_limit_store[key].append(now)
    return True


def _rate_limit(route_name):
    """Decorador de rate limiting por IP + sesión"""
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            if route_name not in RATE_LIMITS:
                return f(*args, **kwargs)
            max_req, window = RATE_LIMITS[route_name]
            ip = request.remote_addr or '0.0.0.0'
            user_part = session.get('cliente_id') or session.get('negocio_slug') or session.get('repartidor_id') or ''
            rl_key = f"rl:{route_name}:{ip}:{user_part}"
            if not _check_rate_limit(rl_key, max_req, window):
                current_app.logger.warning(f"Rate limit excedido para {route_name} desde {ip}")
                if request.is_json or request.path.startswith('/api/'):
                    return jsonify({"error": "Demasiadas solicitudes. Esperá un momento e intentá de nuevo."}), 429
                flash("Demasiadas solicitudes. Esperá un momento e intentá de nuevo.", "error")
                return redirect(request.referrer or '/')
            return f(*args, **kwargs)
        return wrapped
    return decorator


def cleanup_rate_limits():
    """Before-request handler to clean up old rate limit entries periodically."""
    global _last_rate_cleanup
    now = _time.time()
    if now - _last_rate_cleanup > 600:  # cada 10 min
        _last_rate_cleanup = now
        cutoff = now - 3600  # borrar entradas sin uso en la última hora
        keys_to_delete = [k for k, v in _rate_limit_store.items() if not v or v[-1] < cutoff]
        for k in keys_to_delete:
            del _rate_limit_store[k]
