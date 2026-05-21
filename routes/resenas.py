"""
NortFood - Reseñas Blueprint
===================================
Creación y respuesta de reseñas de negocios.
"""
from datetime import datetime

from flask import (
    Blueprint, render_template, request, jsonify,
    redirect, url_for, session, flash, current_app
)
from bson.objectid import ObjectId

from extensions import db
from helpers import validar_objectid
from rate_limit import _rate_limit

resenas_bp = Blueprint('resenas', __name__)


@resenas_bp.route('/api/resenas/<negocio_id>', methods=['POST'])
@_rate_limit('crear_resena')
def crear_resena(negocio_id):
    if not validar_objectid(negocio_id):
        return jsonify({"error": "ID invalido"}), 400

    # Solo clientes logueados pueden reseñar
    if not session.get('cliente_id'):
        return jsonify({"error": "Debes iniciar sesión para dejar una reseña"}), 403

    data = request.json
    puntuacion = data.get('puntuacion')
    comentario = data.get('comentario', '').strip()

    # CORRECCIÓN: Convertir la puntuación a número entero (int)
    try:
        puntuacion = int(puntuacion)
    except (ValueError, TypeError):
        return jsonify({"error": "La puntuación debe ser un número válido"}), 400

    # Ahora sí podemos comparar números con números
    if puntuacion < 1 or puntuacion > 5:
        return jsonify({"error": "La puntuación debe ser entre 1 y 5"}), 400

    if not comentario:
        return jsonify({"error": "El comentario es obligatorio"}), 400

    # Verificar que no haya una reseña previa del mismo cliente para el mismo pedido
    pedido_id = data.get('pedido_id', '')
    if pedido_id:
        resena_existente = db.resenas.find_one({
            "cliente_id": ObjectId(session['cliente_id']),
            "pedido_id": pedido_id
        })
        if resena_existente:
            return jsonify({"error": "Ya dejaste una reseña para este pedido"}), 400

    nueva_resena = {
        "negocio_id": ObjectId(negocio_id),
        "cliente_id": ObjectId(session['cliente_id']),
        "cliente_nombre": session.get('cliente_nombre', 'Anónimo'),
        "pedido_id": data.get('pedido_id', ''),  # Para evitar reseñas duplicadas por pedido
        "puntuacion": puntuacion,  # Aquí ya es un número
        "comentario": comentario,
        "fecha": datetime.now(),
        "respuesta_negocio": None,
        "fecha_respuesta": None
    }

    try:
        db.resenas.insert_one(nueva_resena)

        # OPTIMIZACIÓN: Calcular y guardar el promedio en el documento del negocio
        pipeline = [
            {"$match": {"negocio_id": ObjectId(negocio_id)}},
            {"$group": {"_id": None, "promedio": {"$avg": "$puntuacion"}, "total": {"$sum": 1}}}
        ]
        resultado = list(db.resenas.aggregate(pipeline))

        if resultado:
            nuevo_promedio = round(resultado[0]['promedio'], 1)
            nuevo_total = resultado[0]['total']
            db.negocios.update_one(
                {"_id": ObjectId(negocio_id)},
                {"$set": {"puntuacion_promedio": nuevo_promedio, "total_resenas": nuevo_total}}
            )

        return jsonify({"success": True, "message": "¡Reseña guardada!"}), 201

    except Exception as e:
        current_app.logger.error(f"Error guardando reseña: {e}")
        return jsonify({"error": "Error interno al guardar"}), 500


@resenas_bp.route('/api/resenas/<resena_id>/responder', methods=['POST'])
def responder_resena(resena_id):
    if not validar_objectid(resena_id):
        return jsonify({"error": "ID invalido"}), 400

    # Solo el dueño del local puede responder
    if not session.get('negocio_slug'):
        return jsonify({"error": "No tienes permiso para responder"}), 403

    data = request.json
    respuesta = data.get('respuesta', '').strip()

    if not respuesta:
        return jsonify({"error": "La respuesta no puede estar vacía"}), 400

    try:
        resena = db.resenas.find_one({"_id": ObjectId(resena_id)})
        if not resena:
            return jsonify({"error": "Reseña no encontrada"}), 404

        # Verificar que la reseña pertenece al negocio logueado
        negocio = db.negocios.find_one({"_id": resena["negocio_id"]})
        if not negocio or session['negocio_slug'] != negocio['slug']:
            return jsonify({"error": "No tienes permiso sobre esta reseña"}), 403

        db.resenas.update_one(
            {"_id": ObjectId(resena_id)},
            {"$set": {
                "respuesta_negocio": respuesta,
                "fecha_respuesta": datetime.now()
            }}
        )
        return jsonify({"success": True, "message": "Respuesta guardada"}), 200

    except Exception as e:
        current_app.logger.error(f"Error respondiendo reseña: {e}")
        return jsonify({"error": "Error interno"}), 500
