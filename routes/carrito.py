"""
NortFood - Carrito Blueprint
===================================
Página del carrito de compras de un negocio.
"""
import os

from flask import (
    Blueprint, render_template, request, jsonify,
    redirect, url_for, session, flash, abort, current_app
)
from bson.objectid import ObjectId

from extensions import db, CLOUDINARY_CLOUD_NAME, TARIFA_SERVICIO
from helpers import validar_objectid

carrito_bp = Blueprint('carrito', __name__)


@carrito_bp.route('/<slug_negocio>/carrito')
def carrito(slug_negocio):
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio:
        abort(404)
    if not negocio.get("aprobado", False):
        return render_template('en_revision.html'), 403
    if negocio.get("suspendido", False):
        return render_template('error.html', codigo=403,
                               mensaje="Este negocio se encuentra suspendido temporalmente"), 403

    # Obtener productos para info de imagenes (el carrito se carga via JS desde localStorage)
    productos_lista = list(db.productos.find({"negocio_id": negocio["_id"]}))
    agregados_lista = list(db.agregados.find({"negocio_id": negocio["_id"]}))
    ingredientes_lista = list(db.ingredientes.find({"negocio_id": negocio["_id"]}))

    # Obtener datos del cliente si está logueado (para mostrar direcciones guardadas)
    cliente = None
    if session.get('cliente_id'):
        cliente = db.clientes.find_one({"_id": ObjectId(session['cliente_id'])})

    # Migración: si existe zona_delivery (formato viejo) pero no zonas_delivery, convertir
    if negocio.get('zona_delivery') and not negocio.get('zonas_delivery'):
        precio_viejo = negocio.get('precio_delivery', 0)
        zona_vieja = negocio['zona_delivery']
        if isinstance(zona_vieja, list) and len(zona_vieja) >= 3:
            zonas_nuevas = [{
                "nombre": "Zona 1",
                "puntos": zona_vieja,
                "precio": precio_viejo or 0,
                "color": "#FB8C00"
            }]
            db.negocios.update_one(
                {"slug": negocio['slug']},
                {"$set": {"zonas_delivery": zonas_nuevas}}
            )
            negocio['zonas_delivery'] = zonas_nuevas

    return render_template('carrito.html', negocio=negocio,
                           productos=productos_lista, agregados=agregados_lista,
                           ingredientes=ingredientes_lista,
                           cliente=cliente,
                           cloud_name=CLOUDINARY_CLOUD_NAME,
                           upload_preset=os.getenv("CLOUDINARY_UPLOAD_PRESET", ""),
                           tarifa_servicio=TARIFA_SERVICIO)
