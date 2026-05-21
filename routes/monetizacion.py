"""
NortFood - Monetización Blueprint
===================================
Rutas de deuda, abono y límites + funciones helper de push y deuda
compartidas por otros blueprints (pedidos, repartidor, chat, etc.).
"""
from datetime import datetime

from flask import (
    Blueprint, request, jsonify, session,
    redirect, url_for, flash, abort, current_app
)
from bson.objectid import ObjectId

from extensions import (
    db,
    TARIFA_SERVICIO, LIMITE_SEMANAL_DEUDA, ALIAS_TRANSFERENCIA,
    NOMBRE_TRANSFERENCIA, PORCENTAJE_ALERTA_DEUDA, LIMITE_MINIMO_DEUDA,
)
from helpers import (
    validar_objectid,
    enviar_push_cliente, enviar_push_negocio, enviar_push_repartidores
)
from decorators import requiere_superadmin

monetizacion_bp = Blueprint('monetizacion', __name__)


# ============================================
# HELPER: Límite de deuda (compartida por varios blueprints)
# ============================================

def obtener_limite_deuda(negocio):
    """Devuelve el límite de deuda del negocio, o el default global si no tiene uno personalizado"""
    limite = negocio.get("limite_deuda")
    if limite and limite >= LIMITE_MINIMO_DEUDA:
        return limite
    return LIMITE_SEMANAL_DEUDA


# ============================================
# HELPER: Acumular deuda tarifa (compartida por varios blueprints)
# ============================================

def _acumular_deuda_tarifa(negocio, pedido):
    """
    Acumula la tarifa de servicio a la deuda del negocio cuando un pedido es entregado.
    Si el pedido no tiene tarifa_servicio (pedidos antiguos), usa la tarifa actual.
    Envía notificación push si se alcanza el umbral de alerta o el límite.
    Usa operación atómica con flag deuda_acumulada para evitar doble cobro.
    """
    # Operación atómica: solo marca deuda_acumulada=True si era False/No existía
    # Si ya estaba en True, significa que otro proceso ya acumuló la deuda → no hacer nada
    result = db.pedidos.find_one_and_update(
        {"_id": pedido["_id"], "deuda_acumulada": {"$ne": True}},
        {"$set": {"deuda_acumulada": True}}
    )
    if not result:
        return  # Ya fue acumulado por otro proceso (cliente o repartidor)

    tarifa = pedido.get("tarifa_servicio", TARIFA_SERVICIO)
    limite = obtener_limite_deuda(negocio)

    # Usar $inc atómico para sumar la tarifa a la deuda (evita race conditions)
    db.negocios.update_one(
        {"_id": negocio["_id"]},
        {"$inc": {"deuda_tarifa": tarifa}}
    )

    # Re-leer el negocio después del $inc para obtener la deuda real actualizada
    negocio_actualizado = db.negocios.find_one({"_id": negocio["_id"]})
    deuda_anterior = negocio_actualizado.get("deuda_tarifa", 0) - tarifa
    nueva_deuda = negocio_actualizado.get("deuda_tarifa", 0)

    # Alerta al negocio cuando alcanza el 80% del límite
    umbral_alerta = limite * PORCENTAJE_ALERTA_DEUDA / 100
    if deuda_anterior < umbral_alerta <= nueva_deuda:
        enviar_push_negocio(
            negocio,
            "⚠️ Alerta de deuda",
            f"Tu deuda por tarifa de servicio alcanzó ${nueva_deuda:,.0f}. Límite: ${limite:,.0f}. Alias: {ALIAS_TRANSFERENCIA}",
            url=f"/{negocio['slug']}/historial",
            type='debt_alert'
        )

    # Alerta cuando alcanza el límite y queda oculto
    if deuda_anterior < limite <= nueva_deuda:
        enviar_push_negocio(
            negocio,
            "🚫 Local pausado",
            f"Alcanzaste el límite de deuda (${limite:,.0f}). Tu local se ocultó hasta que saldes la deuda. Alias: {ALIAS_TRANSFERENCIA}",
            url=f"/{negocio['slug']}/historial",
            type='debt_limit_reached'
        )


# ============================================
# RUTAS DE MONETIZACIÓN
# ============================================

@monetizacion_bp.route('/api/negocio/deuda')
def api_negocio_deuda():
    """Devuelve la información de deuda del negocio logueado"""
    if not session.get('negocio_slug'):
        return jsonify({"error": "No autorizado"}), 403

    negocio = db.negocios.find_one({"slug": session['negocio_slug']})
    if not negocio:
        return jsonify({"error": "Negocio no encontrado"}), 404

    deuda = negocio.get("deuda_tarifa", 0)
    limite = obtener_limite_deuda(negocio)
    pedidos_entregados_count = db.pedidos.count_documents({
        "negocio_id": negocio["_id"],
        "estado": "entregado"
    })

    # Calcular cuántos pedidos entregados tienen tarifa de servicio registrada
    pedidos_con_tarifa = list(db.pedidos.find({
        "negocio_id": negocio["_id"],
        "estado": "entregado",
        "tarifa_servicio": {"$exists": True}
    }).sort("fecha", -1).limit(50))

    detalle_tarifas = []
    for p in pedidos_con_tarifa:
        detalle_tarifas.append({
            "pedido_id": str(p["_id"]),
            "cliente_nombre": p.get("cliente_nombre", ""),
            "fecha": p["fecha"].isoformat() if isinstance(p.get("fecha"), datetime) else "",
            "tarifa": p.get("tarifa_servicio", 0)
        })

    return jsonify({
        "deuda": deuda,
        "limite": limite,
        "porcentaje": round((deuda / limite) * 100, 1) if limite > 0 else 0,
        "pedidos_entregados": pedidos_entregados_count,
        "alias_transferencia": ALIAS_TRANSFERENCIA,
        "nombre_transferencia": NOMBRE_TRANSFERENCIA,
        "limite_alcanzado": deuda >= limite,
        "detalle_tarifas": detalle_tarifas
    })


@monetizacion_bp.route('/superadmin/abonar-deuda/<id_negocio>', methods=['POST'])
@requiere_superadmin
def abonar_deuda_negocio(id_negocio):
    """El superadmin registra que el negocio abonó su deuda, reseteándola a 0"""
    if not validar_objectid(id_negocio):
        abort(400)

    negocio = db.negocios.find_one({"_id": ObjectId(id_negocio)})
    if not negocio:
        abort(404)

    deuda_anterior = negocio.get("deuda_tarifa", 0)

    if deuda_anterior <= 0:
        flash("Este negocio no tiene deuda pendiente", "warning")
        return redirect(url_for('auth_superadmin.superadmin'))

    # Registrar el abono en el historial de pagos
    db.deuda_historial.insert_one({
        "negocio_id": negocio["_id"],
        "negocio_nombre": negocio.get("nombre", ""),
        "monto_abonado": deuda_anterior,
        "deuda_anterior": deuda_anterior,
        "fecha_abono": datetime.now(),
        "tipo": "abono_total"
    })

    # Resetear la deuda
    db.negocios.update_one(
        {"_id": ObjectId(id_negocio)},
        {"$set": {"deuda_tarifa": 0}}
    )

    # Notificar al negocio que su deuda fue saldada
    enviar_push_negocio(
        negocio,
        "✅ Deuda saldada",
        f"Tu deuda de ${deuda_anterior:,.0f} por tarifa de servicio fue registrada como pagada. ¡Tu local está activo nuevamente!",
        url=f"/{negocio['slug']}/historial",
        type='debt_cleared'
    )

    flash(f"Deuda de ${deuda_anterior:,.0f} de {negocio.get('nombre', '')} saldada correctamente", "success")
    return redirect(url_for('auth_superadmin.superadmin'))


@monetizacion_bp.route('/superadmin/actualizar-limite-deuda/<id_negocio>', methods=['POST'])
@requiere_superadmin
def actualizar_limite_deuda(id_negocio):
    """El superadmin actualiza el límite de deuda personalizado de un negocio"""
    if not validar_objectid(id_negocio):
        abort(400)

    negocio = db.negocios.find_one({"_id": ObjectId(id_negocio)})
    if not negocio:
        abort(404)

    try:
        nuevo_limite = int(request.form.get("limite_deuda", LIMITE_SEMANAL_DEUDA))
    except (ValueError, TypeError):
        flash("El límite debe ser un número válido", "danger")
        return redirect(url_for('auth_superadmin.superadmin'))

    if nuevo_limite < LIMITE_MINIMO_DEUDA:
        flash(f"El límite mínimo es ${LIMITE_MINIMO_DEUDA:,.0f}", "warning")
        return redirect(url_for('auth_superadmin.superadmin'))

    limite_anterior = obtener_limite_deuda(negocio)

    db.negocios.update_one(
        {"_id": ObjectId(id_negocio)},
        {"$set": {"limite_deuda": nuevo_limite}}
    )

    # Si el negocio estaba oculto por deuda y ahora el nuevo límite es mayor, notificar
    if negocio.get("deuda_tarifa", 0) >= limite_anterior and negocio.get("deuda_tarifa", 0) < nuevo_limite:
        enviar_push_negocio(
            negocio,
            "✅ Límite actualizado",
            f"Tu límite de deuda fue aumentado a ${nuevo_limite:,.0f}. ¡Tu local está visible nuevamente!",
            url=f"/{negocio['slug']}/historial",
            type='debt_limit_updated'
        )

    flash(f"Límite de deuda de {negocio.get('nombre', '')} actualizado a ${nuevo_limite:,.0f}", "success")
    return redirect(url_for('auth_superadmin.superadmin'))
