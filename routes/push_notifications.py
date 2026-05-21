"""
NortFood - Push Notifications Blueprint
=========================================
Rutas para gestión de suscripciones push (negocio y cliente).
Las funciones helper de envío están en routes.monetizacion.
"""
from flask import (
    Blueprint, request, jsonify, session, current_app
)
from bson.objectid import ObjectId

from extensions import db, VAPID_PUBLIC_KEY
from helpers import validar_objectid

push_notifications_bp = Blueprint('push_notifications', __name__)


@push_notifications_bp.route('/api/save-subscription', methods=['POST'])
def save_subscription():
    """Ruta para que el vendedor guarde su suscripción Push"""
    if not session.get('negocio_slug'):
        return jsonify({"error": "No autorizado"}), 403

    sub = request.json
    db.negocios.update_one(
        {"slug": session['negocio_slug']},
        {"$set": {"push_subscription": sub}}
    )
    return jsonify({"success": True})


@push_notifications_bp.route('/api/push/clear-old-subs', methods=['POST'])
def clear_old_push_subs():
    """Limpia suscripciones push antiguas (para forzar re-suscripción con nuevas VAPID keys)"""
    if session.get('negocio_slug'):
        db.negocios.update_one(
            {"slug": session['negocio_slug']},
            {"$set": {"push_subscription": None}}
        )
        return jsonify({"success": True, "message": "Suscripción del negocio limpiada"})
    if session.get('cliente_id'):
        db.clientes.update_one(
            {"_id": ObjectId(session['cliente_id'])},
            {"$set": {"push_subscription": None}}
        )
        return jsonify({"success": True, "message": "Suscripción del cliente limpiada"})
    return jsonify({"error": "No autorizado"}), 403


# --- RUTAS PUSH NOTIFICATIONS PARA CLIENTES ---

@push_notifications_bp.route('/api/push/vapid-key')
def push_vapid_key():
    """Devuelve la VAPID public key para que el cliente se suscriba"""
    if not VAPID_PUBLIC_KEY:
        return jsonify({"error": "VAPID no configurado"}), 503
    return jsonify({"publicKey": VAPID_PUBLIC_KEY})


@push_notifications_bp.route('/api/cliente/push/subscribe', methods=['POST'])
def cliente_push_subscribe():
    """Guarda la suscripción push del cliente logueado"""
    if not session.get('cliente_id'):
        return jsonify({"error": "No autorizado"}), 403

    data = request.json
    subscription = data.get('subscription')

    if not subscription:
        return jsonify({"error": "Suscripción no proporcionada"}), 400

    try:
        db.clientes.update_one(
            {"_id": ObjectId(session['cliente_id'])},
            {"$set": {"push_subscription": subscription}}
        )
        return jsonify({"success": True})
    except Exception as e:
        current_app.logger.error(f"Error guardando suscripción push cliente: {e}")
        return jsonify({"error": "Error interno"}), 500


@push_notifications_bp.route('/api/cliente/push/unsubscribe', methods=['POST'])
def cliente_push_unsubscribe():
    """Elimina la suscripción push del cliente"""
    if not session.get('cliente_id'):
        return jsonify({"error": "No autorizado"}), 403

    data = request.json or {}

    try:
        db.clientes.update_one(
            {"_id": ObjectId(session['cliente_id'])},
            {"$set": {"push_subscription": None}}
        )
        return jsonify({"success": True})
    except Exception as e:
        current_app.logger.error(f"Error eliminando suscripción push cliente: {e}")
        return jsonify({"error": "Error interno"}), 500
