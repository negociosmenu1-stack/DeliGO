"""
NortFood - Cliente Home Blueprint
===================================
Página principal del cliente, pedidos, favoritos, perfil y direcciones.
"""
import os

from flask import (
    Blueprint, render_template, request, jsonify,
    redirect, url_for, session, flash, current_app
)
from werkzeug.security import generate_password_hash, check_password_hash
from bson.objectid import ObjectId

from extensions import db, LIMITE_MINIMO_DEUDA, LIMITE_SEMANAL_DEUDA
from helpers import validar_objectid

cliente_home_bp = Blueprint('cliente_home', __name__)


def obtener_limite_deuda(negocio):
    from extensions import LIMITE_MINIMO_DEUDA, LIMITE_SEMANAL_DEUDA
    limite = negocio.get("limite_deuda")
    if limite and limite >= LIMITE_MINIMO_DEUDA:
        return limite
    return LIMITE_SEMANAL_DEUDA


@cliente_home_bp.route('/')
def home():
    # Si el dueño de un negocio entra, lo mandamos directo a su panel
    if 'negocio_slug' in session:
        return redirect(url_for('catalogo.index', slug_negocio=session['negocio_slug']))

    # Obtenemos todos los negocios aprobados y no suspendidos
    # Filtramos los que alcanzaron su límite de deuda (personalizado por negocio)
    negocios_raw = list(db.negocios.find({
        "aprobado": True,
        "suspendido": False
    }))
    negocios = [n for n in negocios_raw if n.get("deuda_tarifa", 0) < obtener_limite_deuda(n)]

    # Migración: convertir zona_delivery (formato viejo) a zonas_delivery (formato nuevo)
    for neg in negocios:
        if neg.get('zona_delivery') and not neg.get('zonas_delivery'):
            zona_vieja = neg['zona_delivery']
            precio_viejo = neg.get('precio_delivery', 0)
            if isinstance(zona_vieja, list) and len(zona_vieja) >= 3:
                zonas_nuevas = [{
                    "nombre": "Zona 1",
                    "puntos": zona_vieja,
                    "precio": precio_viejo or 0,
                    "color": "#FB8C00"
                }]
                db.negocios.update_one(
                    {"slug": neg['slug']},
                    {"$set": {"zonas_delivery": zonas_nuevas}}
                )
                neg['zonas_delivery'] = zonas_nuevas

    # Obtener favoritos y direcciones del cliente si está logueado
    favoritos_ids = []
    cliente_direcciones = []
    if session.get('cliente_id') and validar_objectid(session['cliente_id']):
        cliente = db.clientes.find_one({"_id": ObjectId(session['cliente_id'])})
        if cliente:
            favoritos_ids = [str(fid) for fid in cliente.get('favoritos', [])]
            cliente_direcciones = cliente.get('direcciones', [])

    # Contar productos en promocion para el banner
    total_promociones = db.productos.count_documents({"descuento_activo": True, "valor_descuento": {"$gt": 0}})

    return render_template('home.html', negocios=negocios, favoritos_ids=favoritos_ids, cliente_direcciones=cliente_direcciones, total_promociones=total_promociones)


@cliente_home_bp.route('/cliente/pedidos')
def cliente_pedidos():
    if not session.get('cliente_id'):
        return redirect(url_for('auth_cliente.login_cliente'))
    if not validar_objectid(session['cliente_id']):
        return redirect(url_for('auth_cliente.login_cliente'))

    # Obtener todos los pedidos del cliente, ordenados por fecha descendente
    pedidos = list(db.pedidos.find({
        "cliente_id": session['cliente_id']
    }).sort("fecha", -1).limit(100))

    # Agrupar por negocio
    negocios_pedidos = {}
    for p in pedidos:
        n_id = str(p.get("negocio_id", ""))
        if n_id not in negocios_pedidos:
            negocio = db.negocios.find_one({"_id": p["negocio_id"]}) if validar_objectid(n_id) else None
            negocios_pedidos[n_id] = {
                "negocio_nombre": p.get("negocio_nombre", ""),
                "negocio_slug": p.get("negocio_slug", ""),
                "logo_url": negocio.get("logo_url", "") if negocio else "",
                "pedidos": []
            }
        # Verificar si ya reseñó este pedido
        # NOTA: cliente_id en la reseña se guarda como ObjectId, hay que usar ObjectId para buscar
        try:
            cliente_oid = ObjectId(session['cliente_id'])
        except Exception:
            cliente_oid = session['cliente_id']
        ya_reseno = db.resenas.find_one({
            "pedido_id": str(p["_id"]),
            "cliente_id": cliente_oid
        }) is not None
        p["ya_reseno"] = ya_reseno
        negocios_pedidos[n_id]["pedidos"].append(p)

    return render_template('historial_cliente.html', negocios_pedidos=negocios_pedidos)


@cliente_home_bp.route('/cliente/favoritos')
def cliente_favoritos():
    if not session.get('cliente_id'):
        return redirect(url_for('auth_cliente.login_cliente'))
    cliente = db.clientes.find_one({"_id": ObjectId(session['cliente_id'])})
    favoritos_ids = cliente.get('favoritos', []) if cliente else []
    # Obtener los negocios favoritos
    favoritos_object_ids = [ObjectId(fid) for fid in favoritos_ids if validar_objectid(fid)]
    negocios = list(db.negocios.find({"_id": {"$in": favoritos_object_ids}, "aprobado": True, "suspendido": False}))
    return render_template('favoritos.html', negocios=negocios)


@cliente_home_bp.route('/cliente/yo')
def cliente_perfil():
    if not session.get('cliente_id'):
        return redirect(url_for('auth_cliente.login_cliente'))
    cliente = db.clientes.find_one({"_id": ObjectId(session['cliente_id'])})
    if not cliente:
        session.pop('cliente_id', None)
        return redirect(url_for('auth_cliente.login_cliente'))
    total_pedidos = db.pedidos.count_documents({"cliente_id": session['cliente_id']})
    favoritos_ids = cliente.get('favoritos', [])
    total_favoritos = len(favoritos_ids)
    return render_template('perfil.html', cliente=cliente, total_pedidos=total_pedidos, total_favoritos=total_favoritos)


@cliente_home_bp.route('/cliente/actualizar-perfil', methods=['POST'])
def cliente_actualizar_perfil():
    if not session.get('cliente_id'):
        return redirect(url_for('auth_cliente.login_cliente'))
    nombre = request.form.get('nombre', '').strip()
    telefono = request.form.get('telefono', '').strip()
    password_actual = request.form.get('password_actual', '')
    password_nueva = request.form.get('password_nueva', '')
    update_data = {}
    if nombre:
        update_data['nombre'] = nombre
        session['cliente_nombre'] = nombre
    if telefono is not None:
        update_data['telefono'] = telefono
    # Cambio de contraseña si se proporcionó
    if password_actual and password_nueva:
        cliente = db.clientes.find_one({"_id": ObjectId(session['cliente_id'])})
        if cliente and cliente.get('password') and check_password_hash(cliente['password'], password_actual):
            if len(password_nueva) >= 6:
                update_data['password'] = generate_password_hash(password_nueva)
            else:
                flash("La nueva contraseña debe tener al menos 6 caracteres", "error")
        else:
            flash("La contraseña actual es incorrecta", "error")
    if update_data:
        try:
            db.clientes.update_one({"_id": ObjectId(session['cliente_id'])}, {"$set": update_data})
            flash("Perfil actualizado correctamente", "success")
        except Exception as e:
            current_app.logger.error(f"Error actualizando perfil: {e}")
            flash("Error al actualizar el perfil", "error")
    return redirect(url_for('cliente_home.cliente_perfil'))


@cliente_home_bp.route('/cliente/agregar-direccion', methods=['POST'])
def cliente_agregar_direccion():
    if not session.get('cliente_id'):
        return jsonify({"error": "No autorizado"}), 403
    data = request.json
    alias = data.get('alias', '').strip()
    direccion = data.get('direccion', '').strip()
    referencia = data.get('referencia', '').strip()
    if not alias or not direccion:
        return jsonify({"error": "Alias y dirección son obligatorios"}), 400
    nueva_dir = {"alias": alias, "direccion": direccion, "referencia": referencia}
    # Guardar coordenadas si vienen
    lat = data.get('lat')
    lng = data.get('lng')
    if lat is not None and lng is not None:
        try:
            nueva_dir['lat'] = float(lat)
            nueva_dir['lng'] = float(lng)
        except (ValueError, TypeError):
            pass
    try:
        db.clientes.update_one(
            {"_id": ObjectId(session['cliente_id'])},
            {"$push": {"direcciones": nueva_dir}}
        )
        return jsonify({"success": True}), 200
    except Exception as e:
        current_app.logger.error(f"Error agregando dirección: {e}")
        return jsonify({"error": "Error al guardar"}), 500


@cliente_home_bp.route('/cliente/editar-direccion', methods=['POST'])
def cliente_editar_direccion():
    if not session.get('cliente_id'):
        return jsonify({"error": "No autorizado"}), 403
    data = request.json
    # Datos originales para identificar la dirección a editar
    old_alias = data.get('old_alias', '').strip()
    old_direccion = data.get('old_direccion', '').strip()
    # Nuevos datos
    alias = data.get('alias', '').strip()
    direccion = data.get('direccion', '').strip()
    referencia = data.get('referencia', '').strip()
    if not alias or not direccion:
        return jsonify({"error": "Alias y dirección son obligatorios"}), 400
    if not old_alias or not old_direccion:
        return jsonify({"error": "Faltan datos de la dirección original"}), 400

    # Construir los campos a actualizar
    update_fields = {
        "direcciones.$.alias": alias,
        "direcciones.$.direccion": direccion,
        "direcciones.$.referencia": referencia
    }
    lat = data.get('lat')
    lng = data.get('lng')
    if lat is not None and lng is not None:
        try:
            update_fields["direcciones.$.lat"] = float(lat)
            update_fields["direcciones.$.lng"] = float(lng)
        except (ValueError, TypeError):
            pass
    else:
        # Si no mandan coordenadas, mantener las existentes (no borrarlas)
        pass

    try:
        result = db.clientes.update_one(
            {
                "_id": ObjectId(session['cliente_id']),
                "direcciones": {"$elemMatch": {"alias": old_alias, "direccion": old_direccion}}
            },
            {"$set": update_fields}
        )
        if result.matched_count == 0:
            return jsonify({"error": "Dirección no encontrada"}), 404
        return jsonify({"success": True}), 200
    except Exception as e:
        current_app.logger.error(f"Error editando dirección: {e}")
        return jsonify({"error": "Error al guardar"}), 500


@cliente_home_bp.route('/cliente/eliminar-direccion', methods=['POST'])
def cliente_eliminar_direccion():
    if not session.get('cliente_id'):
        return jsonify({"error": "No autorizado"}), 403
    data = request.json
    alias = data.get('alias', '').strip()
    direccion = data.get('direccion', '').strip()
    if not alias or not direccion:
        return jsonify({"error": "Alias y dirección son obligatorios"}), 400
    try:
        db.clientes.update_one(
            {"_id": ObjectId(session['cliente_id'])},
            {"$pull": {"direcciones": {"alias": alias, "direccion": direccion}}}
        )
        return jsonify({"success": True}), 200
    except Exception as e:
        current_app.logger.error(f"Error eliminando dirección: {e}")
        return jsonify({"error": "Error al eliminar"}), 500


@cliente_home_bp.route('/api/favoritos/toggle', methods=['POST'])
def api_favoritos_toggle():
    if not session.get('cliente_id'):
        return jsonify({"error": "Debes iniciar sesión"}), 403
    data = request.json
    negocio_id = data.get('negocio_id', '')
    if not negocio_id or not validar_objectid(negocio_id):
        return jsonify({"error": "ID inválido"}), 400
    cliente = db.clientes.find_one({"_id": ObjectId(session['cliente_id'])})
    if not cliente:
        return jsonify({"error": "Cliente no encontrado"}), 404
    favoritos = cliente.get('favoritos', [])
    oid = ObjectId(negocio_id)
    if oid in favoritos:
        db.clientes.update_one({"_id": ObjectId(session['cliente_id'])}, {"$pull": {"favoritos": oid}})
        return jsonify({"es_favorito": False}), 200
    else:
        db.clientes.update_one({"_id": ObjectId(session['cliente_id'])}, {"$push": {"favoritos": oid}})
        return jsonify({"es_favorito": True}), 201
