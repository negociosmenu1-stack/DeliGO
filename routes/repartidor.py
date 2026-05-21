"""
NortFood - Repartidor Blueprint
=================================
Rutas del panel de repartidores, asociación de negocios,
suscripción push y entrega de pedidos.
"""
from datetime import datetime

from flask import (
    Blueprint, render_template, request, jsonify,
    redirect, url_for, session, flash, current_app
)
from bson.objectid import ObjectId

from extensions import db, VAPID_PUBLIC_KEY
from helpers import validar_objectid

repartidor_bp = Blueprint('repartidor', __name__)


@repartidor_bp.route('/repartidor/panel')
def repartidor_panel():
    """Panel del repartidor - muestra pedidos en camino de TODOS sus negocios"""
    if not session.get('repartidor_id'):
        return redirect(url_for('auth_repartidor.repartidor_landing'))

    if not validar_objectid(session['repartidor_id']):
        session.clear()
        return redirect(url_for('auth_repartidor.repartidor_landing'))

    repartidor = db.repartidores.find_one({"_id": ObjectId(session['repartidor_id'])})
    if not repartidor or not repartidor.get("activo"):
        session.clear()
        return redirect(url_for('auth_repartidor.repartidor_landing'))

    # Obtener negocios asociados
    negocios_asociados = repartidor.get("negocios", [])

    # Sincronizar datos de negocios (por si cambiaron nombre/logo)
    negocios_ids = [n.get("negocio_id") for n in negocios_asociados if n.get("negocio_id")]
    negocios_data = {}
    for neg_id in negocios_ids:
        try:
            neg = db.negocios.find_one({"_id": ObjectId(neg_id) if not isinstance(neg_id, ObjectId) else neg_id})
            if neg:
                negocios_data[str(neg_id)] = neg
        except:
            pass

    # Buscar pedidos en camino de TODOS los negocios asociados
    negocio_ids_objectid = []
    for n in negocios_asociados:
        try:
            nid = n.get("negocio_id")
            if nid:
                negocio_ids_objectid.append(ObjectId(nid) if not isinstance(nid, ObjectId) else nid)
        except:
            pass

    pedidos = []
    if negocio_ids_objectid:
        pedidos = list(db.pedidos.find({
            "negocio_id": {"$in": negocio_ids_objectid},
            "estado": "en_camino"
        }).sort("fecha", -1))

    for p in pedidos:
        p.setdefault('items', [])
        # Agregar info del negocio al pedido
        neg_info = negocios_data.get(str(p.get("negocio_id", "")), {})
        p['negocio_nombre'] = neg_info.get("nombre", p.get("negocio_nombre", ""))
        p['negocio_logo_url'] = neg_info.get("logo_url", "")
        p['negocio_slug'] = neg_info.get("slug", p.get("negocio_slug", ""))

    # Si pide JSON (polling)
    if request.args.get('json') == '1':
        resultado = []
        for p in pedidos:
            resultado.append({
                "id": str(p["_id"]),
                "cliente_nombre": p.get("cliente_nombre", ""),
                "estado": p.get("estado", ""),
                "total": p.get("total", 0),
                "metodo_entrega": p.get("metodo_entrega", ""),
                "metodo_pago": p.get("metodo_pago", ""),
                "direccion": p.get("direccion", ""),
                "referencia": p.get("referencia", ""),
                "notas": p.get("notas", ""),
                "lat": p.get("lat"),
                "lng": p.get("lng"),
                "fecha": p["fecha"].isoformat() if isinstance(p.get("fecha"), datetime) else "",
                "items_count": len(p.get("items", [])),
                "negocio_nombre": p.get("negocio_nombre", ""),
                "negocio_logo_url": p.get("negocio_logo_url", ""),
                "negocio_slug": p.get("negocio_slug", ""),
                "cliente_confirma_recibido": p.get("cliente_confirma_recibido", False)
            })
        return jsonify({
            "pedidos": resultado,
            "negocios": [{
                "negocio_id": str(n.get("negocio_id", "")),
                "negocio_nombre": n.get("negocio_nombre", ""),
                "negocio_logo_url": n.get("negocio_logo_url", ""),
                "codigo_acceso": n.get("codigo_acceso", "")
            } for n in negocios_asociados]
        })

    return render_template('repartidor.html',
        paso='panel',
        repartidor=repartidor,
        pedidos=pedidos,
        negocios_asociados=negocios_asociados,
        negocios_data=negocios_data,
        VAPID_PUBLIC_KEY=VAPID_PUBLIC_KEY or '')


@repartidor_bp.route('/repartidor/agregar-negocio', methods=['POST'])
def repartidor_agregar_negocio():
    """Agrega un negocio a la cuenta del repartidor usando el código"""
    if not session.get('repartidor_id'):
        return redirect(url_for('auth_repartidor.repartidor_login'))

    codigo = request.form.get('codigo', '').strip().upper()

    if not codigo:
        flash("Ingresá el código del local", "error")
        return redirect(url_for('repartidor.repartidor_panel'))

    # Buscar el negocio por su código de repartidor
    negocio = db.negocios.find_one({"repartidor_codigo": codigo})
    if not negocio:
        flash("Código inválido. Verificá con el local.", "error")
        return redirect(url_for('repartidor.repartidor_panel'))

    if not negocio.get("aprobado", False) or negocio.get("suspendido", False):
        flash("Este local no está disponible", "error")
        return redirect(url_for('repartidor.repartidor_panel'))

    if not negocio.get("ofrece_delivery"):
        flash("Este local no ofrece delivery", "error")
        return redirect(url_for('repartidor.repartidor_panel'))

    # Verificar si ya está asociado
    repartidor = db.repartidores.find_one({"_id": ObjectId(session['repartidor_id'])})
    negocios_actuales = repartidor.get("negocios", [])

    for n in negocios_actuales:
        if str(n.get("negocio_id", "")) == str(negocio["_id"]):
            flash(f"Ya estás asociado a {negocio.get('nombre', 'este local')}", "error")
            return redirect(url_for('repartidor.repartidor_panel'))

    # Agregar el negocio
    nuevo_negocio = {
        "negocio_id": str(negocio["_id"]),
        "negocio_slug": negocio.get("slug", ""),
        "negocio_nombre": negocio.get("nombre", ""),
        "negocio_logo_url": negocio.get("logo_url", ""),
        "codigo_acceso": codigo,
        "fecha_asociacion": datetime.now()
    }

    db.repartidores.update_one(
        {"_id": ObjectId(session['repartidor_id'])},
        {"$push": {"negocios": nuevo_negocio}}
    )

    flash(f"✅ Te asociaste a {negocio.get('nombre', 'el local')}!", "success")
    return redirect(url_for('repartidor.repartidor_panel'))


@repartidor_bp.route('/repartidor/quitar-negocio', methods=['POST'])
def repartidor_quitar_negocio():
    """Quita un negocio de la cuenta del repartidor"""
    if not session.get('repartidor_id'):
        return jsonify({"error": "No autorizado"}), 403

    data = request.json or {}
    negocio_id = data.get("negocio_id", "")

    db.repartidores.update_one(
        {"_id": ObjectId(session['repartidor_id'])},
        {"$pull": {"negocios": {"negocio_id": negocio_id}}}
    )
    return jsonify({"success": True})


@repartidor_bp.route('/api/repartidor/save-subscription', methods=['POST'])
def repartidor_save_subscription():
    """Guarda la suscripción push del repartidor"""
    if not session.get('repartidor_id'):
        return jsonify({"error": "No autorizado"}), 403

    sub = request.json
    db.repartidores.update_one(
        {"_id": ObjectId(session['repartidor_id'])},
        {"$set": {"push_subscription": sub}}
    )
    return jsonify({"success": True})


@repartidor_bp.route('/api/repartidor/pedidos/<pedido_id>/entregar', methods=['PUT'])
def repartidor_entregar_pedido(pedido_id):
    """El repartidor marca un pedido como entregado (solo delivery con confirmación del cliente)"""
    # Lazy imports para evitar circular imports
    from routes.monetizacion import _acumular_deuda_tarifa

    if not validar_objectid(pedido_id):
        return jsonify({"error": "ID inválido"}), 400

    if not session.get('repartidor_id'):
        return jsonify({"error": "No autorizado"}), 403

    repartidor = db.repartidores.find_one({"_id": ObjectId(session['repartidor_id'])})
    if not repartidor or not repartidor.get("activo"):
        return jsonify({"error": "No autorizado"}), 403

    pedido = db.pedidos.find_one({"_id": ObjectId(pedido_id)})
    if not pedido:
        return jsonify({"error": "Pedido no encontrado"}), 404

    # Verificar que el pedido está en camino
    if pedido.get("estado") != "en_camino":
        return jsonify({"error": "El pedido no está en camino"}), 400

    # Verificar que es un pedido con delivery
    if pedido.get("metodo_entrega") != "domicilio":
        return jsonify({"error": "Solo se pueden entregar pedidos con delivery"}), 400

    # Verificar que el repartidor está asociado al negocio de este pedido
    negocio_id_str = str(pedido.get("negocio_id", ""))
    negocios_repartidor = repartidor.get("negocios", [])
    asociado = any(str(n.get("negocio_id", "")) == negocio_id_str for n in negocios_repartidor)
    if not asociado:
        return jsonify({"error": "No estás asociado a este local"}), 403

    # Verificar que el cliente confirmó la recepción
    if not pedido.get("cliente_confirma_recibido"):
        return jsonify({"error": "El cliente aún no confirmó la recepción del pedido"}), 400

    # Marcar como entregado
    db.pedidos.update_one(
        {"_id": ObjectId(pedido_id)},
        {"$set": {"estado": "entregado", "entregado_por_repartidor": True, "entregado_fecha": datetime.now()}}
    )

    # --- MONETIZACIÓN: Acumular tarifa de servicio a la deuda del negocio ---
    negocio = db.negocios.find_one({"_id": pedido["negocio_id"]})
    if negocio:
        _acumular_deuda_tarifa(negocio, pedido)

    return jsonify({"success": True}), 200


@repartidor_bp.route('/api/repartidor/pedidos-entregados', methods=['GET'])
def repartidor_pedidos_entregados():
    """Pedidos que el repartidor ya entregó hoy (de todos sus negocios)"""
    if not session.get('repartidor_id'):
        return jsonify({"error": "No autorizado"}), 403

    repartidor = db.repartidores.find_one({"_id": ObjectId(session['repartidor_id'])})
    if not repartidor:
        return jsonify({"error": "No autorizado"}), 403

    # Obtener IDs de negocios asociados
    negocio_ids_objectid = []
    for n in repartidor.get("negocios", []):
        try:
            nid = n.get("negocio_id")
            if nid:
                negocio_ids_objectid.append(ObjectId(nid) if not isinstance(nid, ObjectId) else nid)
        except:
            pass

    hoy_inicio = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    pedidos = list(db.pedidos.find({
        "negocio_id": {"$in": negocio_ids_objectid},
        "estado": "entregado",
        "fecha": {"$gte": hoy_inicio}
    }).sort("fecha", -1))

    resultado = []
    for p in pedidos:
        resultado.append({
            "id": str(p["_id"]),
            "cliente_nombre": p.get("cliente_nombre", ""),
            "total": p.get("total", 0),
            "direccion": p.get("direccion", ""),
            "fecha": p["fecha"].isoformat() if isinstance(p.get("fecha"), datetime) else ""
        })
    return jsonify(resultado)
