"""
Helper functions shared across all blueprints.
"""
import os
import html
import json
import random
import string
import hashlib

from bson.objectid import ObjectId
from bson.errors import InvalidId

import cloudinary.uploader
from pywebpush import webpush, WebPushException

from extensions import db, EXTENSIONES_PERMITIDAS, EXTENSIONES_CHAT, PATRON_HORA, PATRON_TELEFONO, CLOUDINARY_CLOUD_NAME, VAPID_PRIVATE_KEY, VAPID_CLAIMS


def extension_permitida(filename):
    if not filename or '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    return ext in EXTENSIONES_PERMITIDAS


def extension_chat_permitida(filename):
    """Permite imágenes y PDFs para el chat"""
    if not filename or '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    return ext in EXTENSIONES_CHAT


def sanitizar_html(texto):
    """Escapa entidades HTML para prevenir ataques XSS al mostrar en innerHTML"""
    if not texto:
        return texto
    return html.escape(str(texto), quote=True)


def filtrar_telefonos(texto):
    """Reemplaza números de teléfono con [***] para evitar contacto fuera de la app"""
    if not texto:
        return texto
    return PATRON_TELEFONO.sub('[***]', texto)


def generar_codigo_repartidor():
    """Genera un código único para que el local comparta con sus repartidores"""
    while True:
        codigo = 'NF-' + ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if not db.negocios.find_one({"repartidor_codigo": codigo}):
            return codigo


def validar_hora(hora, default='00:00'):
    return hora if PATRON_HORA.match(hora) else default


def validar_objectid(oid):
    try:
        ObjectId(oid)
        return True
    except (InvalidId, TypeError):
        return False


def subir_imagen_cloudinary(archivo, carpeta):
    from flask import current_app
    if not archivo or not archivo.filename:
        return None
    if not extension_permitida(archivo.filename):
        return None
    try:
        res = cloudinary.uploader.upload(
            archivo, folder=carpeta,
            overwrite=True, transformation=[{"width": 800, "crop": "limit"}]
        )
        return res.get('secure_url')
    except Exception as e:
        current_app.logger.error(f"Error subiendo imagen a Cloudinary: {e}")
        return None


def extraer_descuento_form(form, prefix=None):
    """Extrae campos de descuento del request.form buscando múltiples variantes de nombres.
    
    El HTML puede tener name='descuento_activo', name='descuento-activo', 
    name='edit-descuento-activo', name='nuevo-descuento-activo', etc.
    Esta función busca todas las variantes posibles y devuelve los valores correctos.
    
    Returns:
        tuple: (descuento_activo: bool, tipo_descuento: str, valor_descuento: float)
    """
    # Variantes de nombres para descuento_activo (checkbox)
    nombres_activo = ['descuento_activo', 'descuento-activo']
    if prefix:
        nombres_activo.insert(0, f'{prefix}-descuento_activo')
        nombres_activo.insert(0, f'{prefix}-descuento-activo')
    
    descuento_activo = False
    for nombre in nombres_activo:
        val = form.get(nombre)
        if val and val in ('on', 'true', '1', 'yes'):
            descuento_activo = True
            break
    
    # Variantes de nombres para tipo_descuento (radio: porcentaje / monto)
    nombres_tipo = ['tipo_descuento', 'tipo-descuento']
    if prefix:
        nombres_tipo.insert(0, f'{prefix}-tipo_descuento')
        nombres_tipo.insert(0, f'{prefix}-tipo-descuento')
    
    tipo_descuento = 'porcentaje'
    for nombre in nombres_tipo:
        val = form.get(nombre, '').strip()
        if val in ('porcentaje', 'monto'):
            tipo_descuento = val
            break
    
    # Variantes de nombres para valor_descuento (number input)
    nombres_valor = ['valor_descuento', 'valor-descuento']
    if prefix:
        nombres_valor.insert(0, f'{prefix}-valor_descuento')
        nombres_valor.insert(0, f'{prefix}-valor-descuento')
    
    valor_descuento = 0.0
    for nombre in nombres_valor:
        val = form.get(nombre, '').strip()
        if val:
            try:
                valor_descuento = float(val)
                if valor_descuento < 0:
                    valor_descuento = 0
                break
            except (ValueError, TypeError):
                continue
    
    return descuento_activo, tipo_descuento, valor_descuento


def verificar_propiedad_producto(producto_id, negocio_id):
    if not validar_objectid(producto_id):
        return None
    producto = db.productos.find_one({"_id": ObjectId(producto_id)})
    if not producto:
        return None
    if producto.get("negocio_id") != negocio_id:
        return None
    return producto


def _regenerar_sesion():
    """Limpia la sesión y genera un nuevo ID para prevenir session fixation"""
    from flask import session
    old_data = dict(session)
    session.clear()
    for key in old_data:
        session[key] = old_data[key]
    session.modified = True


def secrets_token_hex(nbytes=32):
    """Genera bytes aleatorios en hex (usa secrets si está disponible)"""
    try:
        import secrets
        return secrets.token_hex(nbytes)
    except ImportError:
        return hashlib.sha256(os.urandom(nbytes)).hexdigest()


def _generar_token_csrf():
    """Genera un token CSRF basado en la sesión actual"""
    from flask import session
    if 'csrf_token' not in session:
        session['csrf_token'] = secrets_token_hex(32)
    return session['csrf_token']


def _punto_en_poligono(lat, lng, poligono):
    """Verifica si un punto (lat, lng) está dentro de un polígono usando ray-casting"""
    if not poligono or len(poligono) < 3:
        return False
    dentro = False
    n = len(poligono)
    j = n - 1
    for i in range(n):
        lat_i = poligono[i][0]
        lng_i = poligono[i][1]
        lat_j = poligono[j][0]
        lng_j = poligono[j][1]
        if ((lat_i > lat) != (lat_j > lat)) and \
           (lng < (lng_j - lng_i) * (lat - lat_i) / (lat_j - lat_i) + lng_i):
            dentro = not dentro
        j = i
    return dentro


def _negocio_esta_abierto(negocio):
    """Verifica si el negocio está abierto según sus horarios configurados.
    Si no tiene horarios configurados, se asume abierto."""
    from datetime import datetime
    horarios = negocio.get("horarios")
    if not horarios:
        return True

    dia_semana = str(datetime.now().isoweekday())
    horario_dia = horarios.get(dia_semana)

    if not horario_dia:
        return True

    if not horario_dia.get("abierto", True):
        return False

    ahora = datetime.now().strftime("%H:%M")

    apertura = horario_dia.get("apertura", "00:00")
    cierre = horario_dia.get("cierre", "23:59")
    if apertura <= ahora < cierre:
        return True

    if horario_dia.get("turno2"):
        apertura2 = horario_dia.get("apertura2", "00:00")
        cierre2 = horario_dia.get("cierre2", "23:59")
        if apertura2 <= ahora < cierre2:
            return True

    return False


# ============================================
# PUSH NOTIFICATION HELPERS
# ============================================

def enviar_push_cliente(cliente_id, titulo, body, url='/', **kwargs):
    """Envía una notificación push a un cliente por su ID"""
    from flask import current_app
    if not VAPID_PRIVATE_KEY:
        return
    if not validar_objectid(cliente_id):
        return

    cliente = db.clientes.find_one({"_id": ObjectId(cliente_id)})
    if not cliente:
        return

    sub = cliente.get("push_subscription")
    if not sub:
        return

    payload = {
        "title": titulo,
        "body": body,
        "url": url,
        **kwargs
    }

    try:
        webpush(
            subscription_info=sub,
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims=VAPID_CLAIMS
        )
    except WebPushException as e:
        current_app.logger.error(f"Error Push cliente {cliente_id}: {e}")
        if '410' in str(e) or 'invalid' in str(e).lower():
            db.clientes.update_one(
                {"_id": ObjectId(cliente_id)},
                {"$set": {"push_subscription": None}}
            )


def enviar_push_negocio(negocio, titulo, body, url='/', **kwargs):
    """Envía una notificación push a un negocio (recibe el documento completo del negocio)"""
    from flask import current_app
    if not VAPID_PRIVATE_KEY:
        return

    sub = negocio.get("push_subscription")
    if not sub:
        return

    payload = {
        "title": titulo,
        "body": body,
        "url": url,
        **kwargs
    }

    try:
        webpush(
            subscription_info=sub,
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims=VAPID_CLAIMS
        )
    except WebPushException as e:
        current_app.logger.error(f"Error Push negocio {negocio.get('slug', '?')}: {e}")
        if '410' in str(e) or 'invalid' in str(e).lower():
            db.negocios.update_one(
                {"_id": negocio["_id"]},
                {"$set": {"push_subscription": None}}
            )


def enviar_push_repartidores(negocio_id, titulo, body, url='/repartidor/panel', **kwargs):
    """Envía notificación push a todos los repartidores activos de un negocio"""
    from flask import current_app
    if not VAPID_PRIVATE_KEY:
        return

    repartidores = list(db.repartidores.find({
        "negocios.negocio_id": str(negocio_id),
        "activo": True,
        "push_subscription": {"$ne": None}
    }))

    payload = {
        "title": titulo,
        "body": body,
        "url": url,
        **kwargs
    }

    for rep in repartidores:
        sub = rep.get("push_subscription")
        if not sub:
            continue
        try:
            webpush(
                subscription_info=sub,
                data=json.dumps(payload),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS
            )
        except WebPushException as e:
            current_app.logger.error(f"Error Push repartidor {rep.get('_id', '?')}: {e}")
            if '410' in str(e) or 'invalid' in str(e).lower():
                db.repartidores.update_one(
                    {"_id": rep["_id"]},
                    {"$set": {"push_subscription": None}}
                )
