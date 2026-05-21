"""
NortFood - Pedidos Blueprint
==============================
Rutas de creación, actualización y cancelación de pedidos,
más los paneles de pedidos e historial del propietario.
"""
import re
from datetime import datetime, timedelta

from flask import (
    Blueprint, render_template, request, jsonify,
    session, abort, current_app
)
from bson.objectid import ObjectId

from extensions import db, TARIFA_SERVICIO
from helpers import validar_objectid, _punto_en_poligono, _negocio_esta_abierto
from decorators import requiere_negocio_propietario

pedidos_bp = Blueprint('pedidos', __name__)


# ============================================
# PANELES DEL PROPIETARIO
# ============================================

@pedidos_bp.route('/<slug_negocio>/pedidos')
@requiere_negocio_propietario
def panel_pedidos(slug_negocio):
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)

    # Buscar pedidos activos (excluimos los entregados/cancelados) y ordenar por fecha
    pedidos = list(db.pedidos.find({
        "negocio_id": negocio["_id"],
        "estado": {"$nin": ["entregado", "cancelado"]}
    }).sort("fecha", -1))

    # Asegurar que cada pedido tenga la lista de items (evita conflicto con dict.items())
    for p in pedidos:
        p.setdefault('items', [])

    # Si pide JSON (polling), devolver solo la cuenta
    if request.args.get('json') == '1':
        return jsonify({"pedidos": [{"id": str(p["_id"]), "estado": p.get("estado","")} for p in pedidos]})

    return render_template('panel_pedidos.html', negocio=negocio, pedidos=pedidos)


@pedidos_bp.route('/<slug_negocio>/historial')
@requiere_negocio_propietario
def panel_historial(slug_negocio):
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)

    # Filtros
    estado = request.args.get('estado', '')
    fecha_desde = request.args.get('desde', '')
    fecha_hasta = request.args.get('hasta', '')
    buscar = request.args.get('buscar', '').strip()
    pagina = max(1, int(request.args.get('pagina', 1)))
    por_pagina = 20

    # Construir query
    query = {"negocio_id": negocio["_id"], "estado": {"$in": ["entregado", "cancelado"]}}

    if estado and estado in ['entregado', 'cancelado']:
        query["estado"] = estado

    if fecha_desde:
        try:
            dt_desde = datetime.strptime(fecha_desde, '%Y-%m-%d')
            query.setdefault("fecha", {})["$gte"] = dt_desde
        except ValueError:
            pass

    if fecha_hasta:
        try:
            dt_hasta = datetime.strptime(fecha_hasta, '%Y-%m-%d') + timedelta(days=1)
            query.setdefault("fecha", {})["$lt"] = dt_hasta
        except ValueError:
            pass

    if buscar:
        # Escapar caracteres especiales de regex para evitar ReDoS
        buscar_escaped = re.escape(buscar)
        query["$or"] = [
            {"cliente_nombre": {"$regex": buscar_escaped, "$options": "i"}},
            {"direccion": {"$regex": buscar_escaped, "$options": "i"}},
            {"notas": {"$regex": buscar_escaped, "$options": "i"}}
        ]

    # Total para paginación
    total_pedidos = db.pedidos.count_documents(query)
    total_paginas = max(1, (total_pedidos + por_pagina - 1) // por_pagina)
    skip = (pagina - 1) * por_pagina

    # Obtener pedidos
    pedidos = list(db.pedidos.find(query).sort("fecha", -1).skip(skip).limit(por_pagina))
    for p in pedidos:
        p.setdefault('items', [])

    # Stats rápidos (últimos 30 días)
    hace_30 = datetime.now() - timedelta(days=30)
    pedidos_30 = list(db.pedidos.find({
        "negocio_id": negocio["_id"],
        "estado": "entregado",
        "fecha": {"$gte": hace_30}
    }))
    total_ventas_30 = sum(p.get('total', 0) for p in pedidos_30)
    cantidad_30 = len(pedidos_30)
    ticket_promedio = total_ventas_30 / cantidad_30 if cantidad_30 > 0 else 0

    cancelados_30 = db.pedidos.count_documents({
        "negocio_id": negocio["_id"],
        "estado": "cancelado",
        "fecha": {"$gte": hace_30}
    })

    # Si pide JSON (AJAX)
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
                "fecha": p["fecha"].isoformat() if isinstance(p.get("fecha"), datetime) else "",
                "items_count": len(p.get("items", []))
            })
        return jsonify({
            "pedidos": resultado,
            "pagina": pagina,
            "total_paginas": total_paginas,
            "total_pedidos": total_pedidos
        })

    # Lazy imports para evitar circular imports
    from routes.monetizacion import obtener_limite_deuda
    from extensions import ALIAS_TRANSFERENCIA, NOMBRE_TRANSFERENCIA

    return render_template('panel_historial.html',
        negocio=negocio, pedidos=pedidos,
        estado=estado, fecha_desde=fecha_desde, fecha_hasta=fecha_hasta,
        buscar=buscar, pagina=pagina, total_paginas=total_paginas,
        total_pedidos=total_pedidos,
        total_ventas_30=total_ventas_30, cantidad_30=cantidad_30,
        ticket_promedio=ticket_promedio, cancelados_30=cancelados_30,
        deuda_tarifa=negocio.get("deuda_tarifa", 0),
        limite_deuda=obtener_limite_deuda(negocio),
        alias_transferencia=ALIAS_TRANSFERENCIA,
        nombre_transferencia=NOMBRE_TRANSFERENCIA,
        limite_alcanzado=negocio.get("deuda_tarifa", 0) >= obtener_limite_deuda(negocio))


# ============================================
# API PEDIDOS
# ============================================

@pedidos_bp.route('/api/pedidos', methods=['POST'])
def crear_pedido():
    # Lazy imports para evitar circular imports
    from routes.monetizacion import enviar_push_negocio, obtener_limite_deuda

    # Requerir autenticación de cliente
    if not session.get('cliente_id'):
        return jsonify({"error": "Debes iniciar sesión para realizar un pedido"}), 403

    data = request.json
    slug_negocio = data.get('slug')

    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio:
        return jsonify({"error": "Negocio no encontrado"}), 404

    # Rate limiting: máximo 5 pedidos cada 5 minutos por cliente
    cinco_min_atras = datetime.now() - timedelta(minutes=5)
    pedidos_recientes = db.pedidos.count_documents({
        "cliente_id": session['cliente_id'],
        "fecha": {"$gte": cinco_min_atras}
    })
    if pedidos_recientes >= 5:
        return jsonify({"error": "Demasiados pedidos en poco tiempo. Esperá unos minutos."}), 429

    # Verificar si el negocio alcanzó el límite de deuda (no puede recibir pedidos)
    deuda_actual = negocio.get("deuda_tarifa", 0)
    limite = obtener_limite_deuda(negocio)
    if deuda_actual >= limite:
        return jsonify({"error": "Este negocio no está disponible temporalmente. Intentalo más tarde."}), 403

    # Verificar si el negocio está abierto según sus horarios
    if not _negocio_esta_abierto(negocio):
        return jsonify({"error": "Este negocio está cerrado en este horario. Intentalo más tarde."}), 400

    # Validar que los items pertenezcan al negocio y RECALCULAR precios desde DB
    items = data.get("items", [])
    total_productos = 0
    items_validados = []

    if items:
        items_ids = [i.get("productoId") for i in items if i.get("productoId") and validar_objectid(i.get("productoId"))]
        if items_ids:
            # Buscar productos en DB para validar pertenencia y obtener precios reales
            productos_db = {str(p["_id"]): p for p in db.productos.find({
                "_id": {"$in": [ObjectId(pid) for pid in items_ids]},
                "negocio_id": negocio["_id"]
            })}
            if len(productos_db) != len(items_ids):
                return jsonify({"error": "Uno o más productos no pertenecen a este negocio"}), 400

            # Recalcular total desde los precios de la DB (no confiar en el cliente)
            for item in items:
                pid = item.get("productoId")
                prod = productos_db.get(pid)
                if not prod:
                    continue

                # Determinar precio unitario (con descuento si aplica)
                tiene_descuento = prod.get("descuento_activo") and prod.get("valor_descuento", 0) > 0
                if tiene_descuento:
                    valor_desc = prod.get("valor_descuento", 0)
                    tipo_desc = prod.get("tipo_descuento", "porcentaje")
                    precio_base = prod.get("precio", 0)
                    if tipo_desc == "porcentaje":
                        precio_unitario = precio_base * (1 - min(valor_desc, 100) / 100)
                    else:
                        precio_unitario = max(0, precio_base - valor_desc)
                else:
                    precio_unitario = prod.get("precio", 0)

                cantidad = max(1, int(item.get("cantidad", 1)))
                subtotal = precio_unitario * cantidad

                # Sumar agregados si vienen
                agregados_total = 0
                agregados_item = item.get("agregados", [])
                if agregados_item and prod.get("agregados"):
                    # Buscar precios de agregados en DB
                    agregados_ids = [a.get("id") for a in agregados_item if a.get("id") and validar_objectid(a.get("id"))]
                    if agregados_ids:
                        aggs_db = {str(a["_id"]): a for a in db.agregados.find({
                            "_id": {"$in": [ObjectId(aid) for aid in agregados_ids]},
                            "negocio_id": negocio["_id"]
                        })}
                        for agg in agregados_item:
                            agg_db = aggs_db.get(agg.get("id"))
                            if agg_db:
                                agregados_total += agg_db.get("precio", 0)

                subtotal += agregados_total * cantidad
                total_productos += subtotal
                items_validados.append(item)

    precio_delivery = 0
    metodo_entrega = data.get("metodo_entrega", "retiro")

    # Calcular precio de delivery si es a domicilio
    if metodo_entrega == "domicilio":
        lat = data.get("lat")
        lng = data.get("lng")
        if lat and lng and negocio.get("zona_delivery_activa"):
            zonas = negocio.get("zonas_delivery", [])
            precio_calculado = None
            for zona in zonas:
                puntos = zona.get("puntos", [])
                if len(puntos) >= 3 and _punto_en_poligono(float(lat), float(lng), puntos):
                    precio_calculado = zona.get("precio", 0)
                    break
            if precio_calculado is not None:
                precio_delivery = precio_calculado
            else:
                # Cliente fuera de zona de delivery
                return jsonify({"error": "Tu dirección está fuera de la zona de delivery"}), 400
        else:
            # Sin zonas configuradas: usar el precio de delivery del negocio (no del cliente)
            precio_delivery = negocio.get("precio_delivery_default", data.get("precio_delivery", 0))

    total_con_tarifa = total_productos + TARIFA_SERVICIO + precio_delivery

    # Construir el pedido
    nuevo_pedido = {
        "negocio_id": negocio["_id"],
        "negocio_slug": slug_negocio,
        "negocio_nombre": negocio.get("nombre", ""),
        "cliente_id": session.get("cliente_id", ""),
        "cliente_nombre": session.get("cliente_nombre", data.get("cliente_nombre", "Cliente")),
        "cliente_telefono": data.get("cliente_telefono", ""),
        "items": data.get("items", []),
        "total": total_con_tarifa,
        "total_productos": total_productos,
        "tarifa_servicio": TARIFA_SERVICIO,
        "precio_delivery": precio_delivery,
        "metodo_entrega": metodo_entrega,
        "direccion": data.get("direccion", ""),
        "referencia": data.get("referencia", ""),
        "metodo_pago": data.get("metodo_pago", "efectivo"),
        "notas": data.get("notas", ""),
        "estado": "recibido",  # Estados: recibido, preparando, en_camino, entregado
        "fecha": datetime.now()
    }

    # Guardar coordenadas del mapa si vienen
    lat = data.get("lat")
    lng = data.get("lng")
    if lat is not None and lng is not None:
        try:
            nuevo_pedido["lat"] = float(lat)
            nuevo_pedido["lng"] = float(lng)
        except (ValueError, TypeError):
            pass

    try:
        result = db.pedidos.insert_one(nuevo_pedido)
        pedido_id = result.inserted_id

        # ENVIAR NOTIFICACIÓN PUSH AL VENDEDOR
        enviar_push_negocio(
            negocio,
            "🛎️ ¡Nuevo Pedido!",
            f"{nuevo_pedido['cliente_nombre']} - ${nuevo_pedido['total']:,.0f}",
            url=f"/{slug_negocio}/pedidos",
            type='new_order',
            orderId=str(pedido_id)
        )

        return jsonify({"success": True, "pedido_id": str(pedido_id)}), 201

    except Exception as e:
        current_app.logger.error(f"Error guardando pedido: {e}")
        return jsonify({"error": "Error interno al guardar el pedido"}), 500


@pedidos_bp.route('/api/pedidos/<pedido_id>/estado', methods=['PUT'])
def actualizar_estado_pedido(pedido_id):
    # Lazy imports para evitar circular imports
    from routes.monetizacion import enviar_push_cliente, enviar_push_repartidores, _acumular_deuda_tarifa

    if not validar_objectid(pedido_id):
        return jsonify({"error": "ID inválido"}), 400

    if not session.get('negocio_slug'):
        return jsonify({"error": "No autorizado"}), 403

    data = request.json
    nuevo_estado = data.get("estado")

    estados_validos = ["recibido", "preparando", "en_camino", "listo_para_retirar", "entregado", "cancelado"]
    if nuevo_estado not in estados_validos:
        return jsonify({"error": "Estado inválido"}), 400

    pedido = db.pedidos.find_one({"_id": ObjectId(pedido_id)})
    if not pedido:
        return jsonify({"error": "Pedido no encontrado"}), 404

    # No permitir cambiar estado si ya está entregado o cancelado
    if pedido.get("estado") in ["entregado", "cancelado"]:
        return jsonify({"error": "Este pedido ya fue " + pedido["estado"]}), 400

    # Verificar que el pedido pertenece al negocio logueado
    negocio = db.negocios.find_one({"_id": pedido["negocio_id"]})
    if not negocio or session['negocio_slug'] != negocio['slug']:
        return jsonify({"error": "No autorizado"}), 403

    metodo_entrega = pedido.get("metodo_entrega", "retiro")

    # VALIDACIONES SEGÚN MÉTODO DE ENTREGA
    # Delivery: solo puede ir a "en_camino", no a "listo_para_retirar"
    if nuevo_estado == "listo_para_retirar" and metodo_entrega == "domicilio":
        return jsonify({"error": "Los pedidos con delivery usan 'En camino', no 'Listo para retirar'"}), 400

    # Retiro: solo puede ir a "listo_para_retirar", no a "en_camino"
    if nuevo_estado == "en_camino" and metodo_entrega == "retiro":
        return jsonify({"error": "Los pedidos de retiro usan 'Listo para retirar', no 'En camino'"}), 400

    # Si el local no ofrece delivery, no puede poner "en_camino"
    if nuevo_estado == "en_camino" and not negocio.get("ofrece_delivery"):
        return jsonify({"error": "Este local no ofrece delivery"}), 400

    # Si es cancelado, guardar motivo y quién canceló
    update_data = {"estado": nuevo_estado}
    if nuevo_estado == "cancelado":
        update_data["cancelado_por"] = "vendedor"
        update_data["cancelado_fecha"] = datetime.now()
        update_data["cancelado_motivo"] = data.get("motivo", "Rechazado por el local")

    db.pedidos.update_one(
        {"_id": ObjectId(pedido_id)},
        {"$set": update_data}
    )

    # --- NOTIFICAR AL CLIENTE DEL CAMBIO DE ESTADO ---
    cliente_id = pedido.get("cliente_id")
    if cliente_id:
        estado_map = {
            "recibido": ("📥 Pedido recibido", f"Tu pedido en {negocio.get('nombre', '')} fue recibido"),
            "preparando": ("👨‍🍳 Preparando tu pedido", f"Tu pedido en {negocio.get('nombre', '')} está en preparación"),
            "en_camino": ("🛵 Tu pedido va en camino", f"Tu pedido de {negocio.get('nombre', '')} está en camino"),
            "listo_para_retirar": ("📦 Listo para retirar", f"Tu pedido en {negocio.get('nombre', '')} ya está listo"),
            "entregado": ("✅ Pedido entregado", f"Tu pedido en {negocio.get('nombre', '')} fue entregado"),
            "cancelado": ("❌ Pedido cancelado", f"Tu pedido en {negocio.get('nombre', '')} fue cancelado"),
        }
        if nuevo_estado in estado_map:
            titulo, body = estado_map[nuevo_estado]
            enviar_push_cliente(
                cliente_id, titulo, body,
                url='/', type='order_update',
                orderId=str(pedido_id)
            )

    # Si el pedido pasa a "en_camino", notificar a los repartidores del local
    if nuevo_estado == "en_camino":
        direccion = pedido.get("direccion", "")
        cliente_nombre = pedido.get("cliente_nombre", "Cliente")
        negocio_nombre = negocio.get("nombre", "")
        enviar_push_repartidores(
            pedido["negocio_id"],
            f"🛵 ¡Nuevo delivery de {negocio_nombre}!",
            f"Pedido para {cliente_nombre} - {direccion[:40]}",
            url="/repartidor/panel",
            type='new_delivery',
            orderId=str(pedido_id),
            negocio_nombre=negocio_nombre,
            negocio_logo_url=negocio.get("logo_url", "")
        )

    # Si el negocio cancela un pedido de delivery, notificar a los repartidores
    if nuevo_estado == "cancelado" and pedido.get("metodo_entrega") == "domicilio":
        enviar_push_repartidores(
            pedido["negocio_id"],
            "❌ Delivery cancelado",
            f"El local canceló el pedido de {pedido.get('cliente_nombre', 'Cliente')}",
            url="/repartidor/panel",
            type='delivery_cancelled',
            orderId=str(pedido_id)
        )

    # --- MONETIZACIÓN: Si el pedido pasa a "entregado", sumar tarifa a la deuda del negocio ---
    if nuevo_estado == "entregado":
        _acumular_deuda_tarifa(negocio, pedido)

    return jsonify({"success": True}), 200


@pedidos_bp.route('/api/pedidos/<pedido_id>/cancelar', methods=['POST'])
def cancelar_pedido_cliente(pedido_id):
    """Permite al cliente cancelar su pedido dentro de la tolerancia del local"""
    # Lazy imports para evitar circular imports
    from routes.monetizacion import enviar_push_negocio, enviar_push_repartidores

    if not validar_objectid(pedido_id):
        return jsonify({"error": "ID inválido"}), 400

    if not session.get('cliente_id'):
        return jsonify({"error": "Debes iniciar sesión"}), 403

    pedido = db.pedidos.find_one({"_id": ObjectId(pedido_id)})
    if not pedido:
        return jsonify({"error": "Pedido no encontrado"}), 404

    # Verificar que es el cliente dueño del pedido
    if str(pedido.get('cliente_id', '')) != str(session['cliente_id']):
        return jsonify({"error": "No autorizado"}), 403

    # No cancelar si ya está entregado o cancelado
    if pedido.get("estado") in ["entregado", "cancelado"]:
        return jsonify({"error": "Este pedido ya fue " + pedido["estado"]}), 400

    # Verificar tolerancia de cancelación del negocio
    negocio = db.negocios.find_one({"_id": pedido["negocio_id"]})
    tolerancia_minutos = negocio.get("tolerancia_cancelacion", 5) if negocio else 5

    # Calcular tiempo transcurrido desde la creación del pedido
    fecha_pedido = pedido.get("fecha")
    if fecha_pedido:
        if isinstance(fecha_pedido, str):
            try:
                fecha_pedido = datetime.fromisoformat(fecha_pedido)
            except ValueError:
                fecha_pedido = None
        if isinstance(fecha_pedido, datetime):
            minutos_transcurridos = (datetime.now() - fecha_pedido).total_seconds() / 60
            if minutos_transcurridos > tolerancia_minutos:
                return jsonify({
                    "error": f"Ya pasaron los {tolerancia_minutos} minutos de tolerancia para cancelar",
                    "tolerancia_minutos": tolerancia_minutos,
                    "minutos_transcurridos": round(minutos_transcurridos, 1)
                }), 400

    data = request.json or {}
    motivo = data.get("motivo", "Cancelado por el cliente")

    db.pedidos.update_one(
        {"_id": ObjectId(pedido_id)},
        {"$set": {
            "estado": "cancelado",
            "cancelado_por": "cliente",
            "cancelado_fecha": datetime.now(),
            "cancelado_motivo": motivo
        }}
    )

    # Notificar al vendedor por push si tiene suscripción
    if negocio:
        enviar_push_negocio(
            negocio,
            "❌ Pedido cancelado",
            f"El cliente canceló el pedido",
            url=f"/{negocio['slug']}/pedidos",
            type='order_cancelled',
            orderId=str(pedido_id)
        )
        # Si era delivery, notificar también a los repartidores
        if pedido.get("metodo_entrega") == "domicilio":
            enviar_push_repartidores(
                pedido["negocio_id"],
                "❌ Pedido cancelado",
                f"El cliente canceló el delivery - {pedido.get('cliente_nombre', 'Cliente')}",
                url="/repartidor/panel",
                type='delivery_cancelled',
                orderId=str(pedido_id)
            )

    return jsonify({"success": True, "message": "Pedido cancelado correctamente"}), 200


@pedidos_bp.route('/api/pedidos/<pedido_id>/confirmar-recibido', methods=['POST'])
def confirmar_recibido_cliente(pedido_id):
    """El cliente confirma que recibió el pedido del repartidor (solo delivery)"""
    # Lazy imports para evitar circular imports
    from routes.monetizacion import enviar_push_repartidores, _acumular_deuda_tarifa

    if not validar_objectid(pedido_id):
        return jsonify({"error": "ID inválido"}), 400

    if not session.get('cliente_id'):
        return jsonify({"error": "No autorizado"}), 403

    pedido = db.pedidos.find_one({"_id": ObjectId(pedido_id)})
    if not pedido:
        return jsonify({"error": "Pedido no encontrado"}), 404

    # Solo el cliente dueño del pedido puede confirmar
    if pedido.get("cliente_id") != session['cliente_id']:
        return jsonify({"error": "No autorizado"}), 403

    # Solo se puede confirmar si el pedido está en_camino y es delivery
    if pedido.get("estado") != "en_camino":
        return jsonify({"error": "El pedido no está en camino"}), 400

    if pedido.get("metodo_entrega") != "domicilio":
        return jsonify({"error": "Solo se confirma recepción en pedidos con delivery"}), 400

    # Si ya confirmó, no hacer nada
    if pedido.get("cliente_confirma_recibido"):
        return jsonify({"success": True, "message": "Ya confirmaste la recepción"}), 200

    db.pedidos.update_one(
        {"_id": ObjectId(pedido_id)},
        {"$set": {"cliente_confirma_recibido": True, "cliente_confirma_fecha": datetime.now()}}
    )

    # Notificar al repartidor que el cliente confirmó
    negocio = db.negocios.find_one({"_id": pedido["negocio_id"]})
    enviar_push_repartidores(
        pedido["negocio_id"],
        f"✅ {pedido.get('cliente_nombre', 'Cliente')} confirmó recepción",
        "Ya podés marcar el pedido como entregado",
        url="/repartidor/panel",
        type='delivery_confirmed',
        orderId=str(pedido_id)
    )

    # --- MONETIZACIÓN: Acumular tarifa cuando el cliente confirma recepción ---
    # Esto evita que el negocio evada la deuda diciéndole al repartidor que no marque entregado
    if negocio:
        _acumular_deuda_tarifa(negocio, pedido)

    return jsonify({"success": True, "message": "Recepción confirmada"}), 200


@pedidos_bp.route('/api/pedidos/<pedido_id>/repetir', methods=['GET', 'POST'])
def repetir_pedido(pedido_id):
    """Permite al cliente repetir un pedido anterior.
    Devuelve items_repetir (van directo al carrito) e items_sin_match
    (necesitan re-configurarse en el catálogo o ya no existen)."""
    if not validar_objectid(pedido_id):
        return jsonify({"error": "ID inválido"}), 400

    if not session.get('cliente_id'):
        return jsonify({"error": "Debes iniciar sesión"}), 403

    pedido = db.pedidos.find_one({"_id": ObjectId(pedido_id)})
    if not pedido:
        return jsonify({"error": "Pedido no encontrado"}), 404

    # Verificar que es el cliente dueño del pedido
    if str(pedido.get('cliente_id', '')) != str(session['cliente_id']):
        return jsonify({"error": "No autorizado"}), 403

    # Obtener datos del negocio
    negocio = db.negocios.find_one({"_id": pedido["negocio_id"]})
    if not negocio:
        return jsonify({"error": "El negocio ya no existe"}), 404

    # Verificar si el negocio está suspendido o con deuda límite
    from routes.monetizacion import obtener_limite_deuda
    if negocio.get("suspendido"):
        return jsonify({"error": "Este negocio está suspendido temporalmente"}), 400
    if negocio.get("deuda_tarifa", 0) >= obtener_limite_deuda(negocio):
        return jsonify({"error": "Este negocio no está disponible temporalmente"}), 400

    items_originales = pedido.get("items", [])
    items_repetir = []      # Items que van directo al carrito (con todos sus datos)
    items_sin_match = []    # Productos que ya no existen o no están disponibles

    if items_originales:
        # Buscar productos actuales en DB para validar existencia y obtener precios actualizados
        items_ids = [i.get("productoId") for i in items_originales if i.get("productoId") and validar_objectid(i.get("productoId"))]
        productos_db = {}
        if items_ids:
            productos_db = {str(p["_id"]): p for p in db.productos.find({
                "_id": {"$in": [ObjectId(pid) for pid in items_ids]},
                "negocio_id": negocio["_id"]
            })}

        # Buscar agregados en DB para obtener precios actualizados
        agregados_ids = []
        for item in items_originales:
            for a in (item.get("agregados") or []):
                aid = a.get("id", "")
                if aid and validar_objectid(aid):
                    agregados_ids.append(aid)
        agregados_db = {}
        if agregados_ids:
            agregados_db = {str(a["_id"]): a for a in db.agregados.find({
                "_id": {"$in": [ObjectId(aid) for aid in agregados_ids]},
                "negocio_id": negocio["_id"]
            })}

        for item in items_originales:
            pid = item.get("productoId", "")
            prod = productos_db.get(pid)

            if not prod or not prod.get("disponible", True):
                # Producto ya no existe o no está disponible
                items_sin_match.append({
                    "nombre": item.get("nombre", "Producto eliminado"),
                    "producto_id": pid if prod else None
                })
                continue

            # Calcular precio base actualizado (con descuento si aplica)
            tiene_descuento = prod.get("descuento_activo") and prod.get("valor_descuento", 0) > 0
            if tiene_descuento:
                valor_desc = prod.get("valor_descuento", 0)
                tipo_desc = prod.get("tipo_descuento", "porcentaje")
                precio_base = prod.get("precio", 0)
                if tipo_desc == "porcentaje":
                    precio_unitario = precio_base * (1 - min(valor_desc, 100) / 100)
                else:
                    precio_unitario = max(0, precio_base - valor_desc)
            else:
                precio_unitario = prod.get("precio", 0)

            # Actualizar precios de agregados desde DB
            agregados_actualizados = []
            for a in (item.get("agregados") or []):
                agg_db = agregados_db.get(a.get("id", ""))
                if agg_db:
                    agregados_actualizados.append({
                        "id": a.get("id", ""),
                        "nombre": a.get("nombre", agg_db.get("nombre", "")),
                        "precio": agg_db.get("precio", 0)
                    })
                else:
                    # Agregado ya no existe, mantener el original
                    agregados_actualizados.append(a)

            # Reconstruir seccionesPrecios desde los datos del producto en DB
            # (los pedidos viejos no tienen seccionesPrecios guardado)
            secciones_precios = item.get("seccionesPrecios", {})
            if not secciones_precios and item.get("secciones"):
                # Intentar reconstruir desde las secciones del producto
                producto_secciones = prod.get("secciones", [])
                if isinstance(producto_secciones, list):
                    for sec in producto_secciones:
                        sec_nombre = sec.get("nombre", "")
                        sec_items = sec.get("items", [])
                        opciones_elegidas = item.get("secciones", {}).get(sec_nombre, [])
                        if not isinstance(opciones_elegidas, list):
                            opciones_elegidas = [opciones_elegidas]
                        for opt in sec_items:
                            if opt.get("nombre") in opciones_elegidas and opt.get("precio", 0) > 0:
                                key = sec_nombre + "|" + opt["nombre"]
                                secciones_precios[key] = opt["precio"]

            # Devolver el item completo con todos sus datos y precios actualizados
            item_repetir = {
                "productoId": pid,
                "nombre": prod.get("nombre", item.get("nombre", "")),
                "precio": precio_unitario,
                "cantidad": item.get("cantidad", 1),
                # Personalizaciones del pedido original con precios actualizados
                "agregados": agregados_actualizados,
                "secciones": item.get("secciones", {}),
                "ingredientes": item.get("ingredientes", []),
                "ingredientesQuitados": item.get("ingredientesQuitados", []),
                "listasSeccion": item.get("listasSeccion", []),
                "listasSeccionQuitados": item.get("listasSeccionQuitados", {}),
                "seccionesPrecios": secciones_precios,
                "talle": item.get("talle", ""),
                "color": item.get("color", ""),
            }
            items_repetir.append(item_repetir)

    return jsonify({
        "success": True,
        "negocio_slug": pedido.get("negocio_slug", ""),
        "items_repetir": items_repetir,
        "items_sin_match": items_sin_match
    }), 200
