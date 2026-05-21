"""
NortFood - Promociones Blueprint
===================================
Página de promociones para clientes.
"""
from flask import (
    Blueprint, render_template, request, jsonify,
    redirect, url_for, session, flash, current_app
)
from bson.objectid import ObjectId

from extensions import db
from helpers import validar_objectid

promociones_bp = Blueprint('promociones', __name__)


@promociones_bp.route('/cliente/promociones')
def cliente_promociones():
    if not session.get('cliente_id'):
        return redirect(url_for('auth_cliente.login_cliente'))
    # Buscar productos con descuento activo en negocios aprobados y no suspendidos
    pipeline = [
        {"$match": {"descuento_activo": True, "valor_descuento": {"$gt": 0}}},
        {"$lookup": {
            "from": "negocios",
            "localField": "negocio_id",
            "foreignField": "_id",
            "as": "negocio"
        }},
        {"$unwind": "$negocio"},
        {"$match": {"negocio.aprobado": True, "negocio.suspendido": False}}
    ]
    productos_con_descuento = list(db.productos.aggregate(pipeline))

    # Obtener favoritos del cliente
    cliente = db.clientes.find_one({"_id": ObjectId(session['cliente_id'])})
    favoritos_ids = [str(fid) for fid in (cliente.get('favoritos', []) if cliente else [])]

    promociones = []
    for prod in productos_con_descuento:
        neg = prod['negocio']
        es_favorito = str(neg['_id']) in favoritos_ids
        tipo = prod.get('tipo_descuento', 'porcentaje')
        valor = prod.get('valor_descuento', 0)
        if tipo == 'porcentaje':
            descuento_str = f"{int(valor)}%"
        else:
            descuento_str = f"${valor:.0f}"
        promociones.append({
            'negocio_slug': neg.get('slug', ''),
            'negocio_logo': neg.get('logo_url', ''),
            'negocio_nombre': neg.get('nombre', ''),
            'negocio_rubro': neg.get('rubro', '').capitalize(),
            'es_favorito': es_favorito,
            'tipo': tipo,
            'descuento': descuento_str,
            'titulo': prod.get('nombre', 'Producto en oferta'),
            'descripcion': f"Antes ${prod.get('precio', 0):.2f} — Ahora ${prod.get('precio_promo', 0):.2f}",
            'fecha_fin': None,
            'producto_imagen': prod.get('imagen_url', ''),
            'precio_original': prod.get('precio', 0),
            'precio_promo': prod.get('precio_promo', 0),
            'valor_descuento': valor,
            'tipo_descuento': tipo
        })

    # Ordenar: favoritos primero, luego por mayor descuento
    promociones.sort(key=lambda p: (not p['es_favorito'], -p['valor_descuento']))

    return render_template('promociones.html', promociones=promociones)
