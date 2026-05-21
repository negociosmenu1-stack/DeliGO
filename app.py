"""
NortFood - Aplicación Principal
===================================
Archivo de configuración y registro de Blueprints.
Todas las rutas están separadas en archivos individuales dentro de routes/.
"""
import os
import hashlib
import hmac

from flask import (
    Flask, render_template, request, jsonify,
    session, flash, redirect, url_for, make_response
)
from flask.json.provider import DefaultJSONProvider
from dotenv import load_dotenv
from bson.objectid import ObjectId
from datetime import datetime, timedelta

# ============================================
# IMPORTAR CONFIGURACIÓN CENTRALIZADA
# ============================================
from extensions import init_oauth
from rate_limit import cleanup_rate_limits
from helpers import _generar_token_csrf, validar_objectid

load_dotenv()

# ============================================
# CREAR APP FLASK
# ============================================
app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY")

if not app.secret_key:
    raise RuntimeError("SECRET_KEY no configurada. Definila en tu archivo .env")

app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = os.getenv("FLASK_ENV") == "production"
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=12)
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024

# ============================================
# INICIALIZAR OAUTH (requiere la app Flask)
# ============================================
init_oauth(app)

# ============================================
# JSON PROVIDER (soporte para ObjectId y datetime)
# ============================================
class MongoJSONProvider(DefaultJSONProvider):
    def default(self, obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)

app.json = MongoJSONProvider(app)

# ============================================
# BEFORE REQUEST: Rate Limiting Cleanup
# ============================================
@app.before_request
def _before_cleanup_rate_limits():
    cleanup_rate_limits()

# ============================================
# SISTEMA CSRF (Double Submit Cookie)
# ============================================
# Rutas exentas de CSRF (endpoints con blueprint prefix)
CSRF_EXEMPT_ROUTES = {
    'auth_cliente.login_cliente', 'auth_negocio.login', 'auth_superadmin.superadmin',
    'auth_cliente.login_google', 'auth_cliente.auth_google_callback',
    'auth_repartidor.repartidor_login', 'auth_repartidor.repartidor_registro',
    'auth_cliente.registro_cliente', 'auth_negocio.procesar_registro',
    'push_notifications.push_vapid_key',
    'auth_cliente.logout_cliente', 'auth_negocio.logout', 'auth_repartidor.repartidor_logout',
    # Rutas de catálogo y configuración del negocio (protegidas por @requiere_negocio +
    # SameSite=Lax session cookie; los templates no incluyen campo csrf_token)
    'catalogo.agregar_producto', 'catalogo.editar_producto', 'catalogo.eliminar_producto',
    'catalogo.agregar_agregado', 'catalogo.editar_agregado', 'catalogo.eliminar_agregado',
    'catalogo.agregar_categoria_agregado', 'catalogo.eliminar_categoria_agregado',
    'catalogo.agregar_ingrediente', 'catalogo.editar_ingrediente', 'catalogo.eliminar_ingrediente',
    'catalogo.agregar_categoria_ingrediente', 'catalogo.eliminar_categoria_ingrediente',
    'catalogo.agregar_categoria', 'catalogo.editar_categoria', 'catalogo.eliminar_categoria',
    'catalogo.agregar_seccion_catalogo', 'catalogo.editar_seccion_catalogo',
    'catalogo.eliminar_seccion_catalogo', 'catalogo.ordenar_secciones_catalogo',
    'configuracion.update_config', 'configuracion.update_logo', 'configuracion.update_horarios',
}


def _validar_csrf():
    """Valida el token CSRF para requests que modifican estado"""
    token_header = request.headers.get('X-CSRFToken', '')
    token_form = request.form.get('csrf_token', '')
    token_json = ''
    if request.is_json:
        try:
            token_json = request.json.get('csrf_token', '') if request.json else ''
        except Exception:
            token_json = ''

    token_recibido = token_header or token_form or token_json
    token_esperado = session.get('csrf_token', '')

    if not token_esperado or not token_recibido:
        return False

    return hmac.compare_digest(token_recibido, token_esperado)


@app.before_request
def csrf_protect():
    """Middleware CSRF: valida tokens en requests que modifican estado"""
    if request.method not in ('POST', 'PUT', 'PATCH', 'DELETE'):
        return None

    # Eximir rutas específicas
    if request.endpoint in CSRF_EXEMPT_ROUTES:
        return None

    # Eximir rutas de API JSON (protegidas por SameSite=Lax + session)
    api_json_routes = {
        'chat.chat_subir_imagen', 'chat.share_target',
        'pedidos.crear_pedido', 'pedidos.actualizar_estado_pedido',
        'pedidos.cancelar_pedido_cliente', 'pedidos.confirmar_recibido_cliente',
        'chat.chat_enviar', 'resenas.crear_resena',
        'resenas.responder_resena', 'push_notifications.save_subscription',
        'push_notifications.clear_old_push_subs',
        'push_notifications.cliente_push_subscribe',
        'push_notifications.cliente_push_unsubscribe',
        'configuracion.regenerar_codigo_repartidor', 'monetizacion.api_negocio_deuda',
        'chat.chat_mensajes', 'chat.chat_no_leidos', 'chat.cliente_pedidos_activos',
        'catalogo.api_producto', 'push_notifications.push_vapid_key',
        'catalogo.api_editar_categoria', 'catalogo.api_eliminar_categoria',
        'configuracion.guardar_zona_delivery', 'monetizacion.abonar_deuda_negocio',
        'monetizacion.actualizar_limite_deuda',
        'repartidor.repartidor_agregar_negocio', 'repartidor.repartidor_quitar_negocio',
        'cliente_home.api_favoritos_toggle',
        'pedidos.repetir_pedido',
    }
    if request.endpoint in api_json_routes:
        return None

    # Eximir rutas que empiezan con /api/
    if request.path.startswith('/api/'):
        return None

    # Para rutas protegidas con sesión, validar CSRF
    tiene_sesion = (session.get('negocio_slug') or
                    session.get('cliente_id') or
                    session.get('superadmin_logueado') or
                    session.get('repartidor_id'))

    if tiene_sesion and not _validar_csrf():
        app.logger.warning(f"CSRF fallido para {request.endpoint} desde {request.remote_addr}")
        if request.is_json or request.path.startswith('/api/'):
            return jsonify({"error": "Token CSRF inválido. Recargá la página e intentá de nuevo."}), 403
        flash("Error de seguridad. Recargá la página e intentá de nuevo.", "error")
        return redirect(request.referrer or '/')


@app.context_processor
def inject_csrf_token():
    """Inyecta el token CSRF en todos los templates"""
    return {'csrf_token': _generar_token_csrf}

# ============================================
# RUTAS ESTÁTICAS (PWA)
# ============================================

@app.route('/sw.js')
def service_worker():
    import os as _os
    sw_path = _os.path.join(_os.path.dirname(__file__), 'sw.js')
    if _os.path.exists(sw_path):
        with open(sw_path, 'r') as f:
            content = f.read()
        response = make_response(content)
    else:
        response = make_response(app.send_static_file('js/sw.js'))
    response.headers['Content-Type'] = 'application/javascript'
    response.headers['Cache-Control'] = 'no-cache'
    return response


@app.route('/manifest.json')
def manifest():
    import os as _os
    mf_path = _os.path.join(_os.path.dirname(__file__), 'manifest.json')
    if _os.path.exists(mf_path):
        with open(mf_path, 'r') as f:
            content = f.read()
        response = make_response(content)
    else:
        response = make_response(app.send_static_file('manifest.json'))
    response.headers['Content-Type'] = 'application/manifest+json'
    response.headers['Cache-Control'] = 'no-cache'
    return response

# ============================================
# MANEJO DE ERRORES
# ============================================

@app.errorhandler(400)
def bad_request(e):
    return render_template('error.html', codigo=400, mensaje="Solicitud invalida"), 400

@app.errorhandler(403)
def forbidden(e):
    return render_template('error.html', codigo=403, mensaje="No tienes permiso para acceder aqui"), 403

@app.errorhandler(404)
def not_found(e):
    return render_template('error.html', codigo=404, mensaje="Pagina no encontrada"), 404

@app.errorhandler(413)
def request_entity_too_large(e):
    return "El archivo es demasiado grande. Maximo permitido: 5MB", 413

@app.errorhandler(500)
def internal_error(e):
    return render_template('error.html', codigo=500, mensaje="Error interno del servidor"), 500

# ============================================
# HEADERS DE SEGURIDAD
# ============================================

@app.after_request
def agregar_headers_seguridad(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://unpkg.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data: https://res.cloudinary.com https://*.tile.openstreetmap.org https://*.openstreetmap.org; "
        "connect-src 'self' https://nominatim.openstreetmap.org"
    )
    content_type = response.content_type or ''
    if 'text/html' in content_type:
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response

# ============================================
# REGISTRAR BLUEPRINTS
# ============================================
from routes import register_blueprints
register_blueprints(app)

# ============================================
# EJECUTAR APP
# ============================================
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
