"""
NortFood - Chat Blueprint
===================================
Chat de pedidos, compartir archivos y conteo de no leídos.
"""
import os
import json

from datetime import datetime

from flask import (
    Blueprint, render_template, request, jsonify,
    redirect, url_for, session, flash, current_app
)
from bson.objectid import ObjectId

import cloudinary.uploader

from extensions import db
from helpers import (
    validar_objectid, sanitizar_html, filtrar_telefonos,
    extension_chat_permitida, subir_imagen_cloudinary,
    enviar_push_cliente, enviar_push_negocio, enviar_push_repartidores
)
from rate_limit import _rate_limit

chat_bp = Blueprint('chat', __name__)


@chat_bp.route('/api/cliente/pedidos-activos')
def cliente_pedidos_activos():
    """Devuelve los pedidos activos del cliente logueado"""
    if not session.get('cliente_id'):
        return jsonify({"error": "No autorizado"}), 403
    if not validar_objectid(session['cliente_id']):
        return jsonify({"error": "ID inválido"}), 400

    pedidos = list(db.pedidos.find({
        "cliente_id": session['cliente_id'],
        "estado": {"$nin": ["entregado", "cancelado"]}
    }).sort("fecha", -1))

    # Serializar para JSON
    resultado = []
    for p in pedidos:
        # Obtener tolerancia de cancelación del negocio
        negocio = db.negocios.find_one({"_id": p.get("negocio_id")})
        tolerancia = negocio.get("tolerancia_cancelacion", 5) if negocio else 5

        # Calcular minutos transcurridos para saber si puede cancelar
        puede_cancelar = False
        minutos_restantes = 0
        fecha_p = p.get("fecha")
        if fecha_p and isinstance(fecha_p, datetime):
            minutos_transcurridos = (datetime.now() - fecha_p).total_seconds() / 60
            minutos_restantes = max(0, tolerancia - minutos_transcurridos)
            puede_cancelar = minutos_transcurridos <= tolerancia
        elif tolerancia == 0:
            puede_cancelar = False
        else:
            puede_cancelar = True  # Si no hay fecha, permitir

        resultado.append({
            "id": str(p["_id"]),
            "negocio_nombre": p.get("negocio_nombre", ""),
            "negocio_slug": p.get("negocio_slug", ""),
            "estado": p.get("estado", "recibido"),
            "total": p.get("total", 0),
            "metodo_entrega": p.get("metodo_entrega", "retiro"),
            "metodo_pago": p.get("metodo_pago", "efectivo"),
            "fecha": p["fecha"].isoformat() if isinstance(p.get("fecha"), datetime) else "",
            "items_count": len(p.get("items", [])),
            "puede_cancelar": puede_cancelar,
            "minutos_restantes_cancelar": round(minutos_restantes, 1),
            "tolerancia_cancelacion": tolerancia,
            "cliente_confirma_recibido": p.get("cliente_confirma_recibido", False)
        })

    return jsonify(resultado)


@chat_bp.route('/api/chat/<pedido_id>/mensajes')
def chat_mensajes(pedido_id):
    """Obtiene los mensajes del chat de un pedido"""
    # Verificar permisos: cliente dueño o vendedor del negocio
    pedido = db.pedidos.find_one({"_id": ObjectId(pedido_id)}) if validar_objectid(pedido_id) else None
    if not pedido:
        return jsonify({"error": "Pedido no encontrado"}), 404

    # Verificar que es el cliente, el vendedor o el repartidor asociado
    es_cliente = session.get('cliente_id') and str(session['cliente_id']) == str(pedido.get('cliente_id', ''))
    es_vendedor = session.get('negocio_slug') and str(pedido.get('negocio_slug', '')) == session['negocio_slug']
    # S4 FIX: Verificar también si es repartidor asociado al negocio del pedido
    es_repartidor = False
    if session.get('repartidor_id') and validar_objectid(session['repartidor_id']) and not es_cliente and not es_vendedor:
        rep = db.repartidores.find_one({"_id": ObjectId(session['repartidor_id'])})
        if rep and rep.get('activo'):
            negocio_id_str = str(pedido.get('negocio_id', ''))
            es_repartidor = any(str(n.get('negocio_id', '')) == negocio_id_str for n in rep.get('negocios', []))
    if not es_cliente and not es_vendedor and not es_repartidor:
        return jsonify({"error": "No autorizado"}), 403

    mensajes = list(db.chat_mensajes.find({"pedido_id": pedido_id}).sort("fecha", 1))

    # Marcar mensajes como leídos según quien sea
    if es_cliente:
        db.chat_mensajes.update_many(
            {"pedido_id": pedido_id, "remitente": {"$in": ["vendedor", "repartidor"]}, "leido": False},
            {"$set": {"leido": True}}
        )
    elif es_vendedor:
        db.chat_mensajes.update_many(
            {"pedido_id": pedido_id, "remitente": {"$in": ["cliente", "repartidor"]}, "leido": False},
            {"$set": {"leido": True}}
        )
    elif es_repartidor:
        db.chat_mensajes.update_many(
            {"pedido_id": pedido_id, "remitente": {"$in": ["cliente", "vendedor"]}, "leido": False},
            {"$set": {"leido": True}}
        )

    resultado = []
    for m in mensajes:
        resultado.append({
            "id": str(m["_id"]),
            "remitente": m.get("remitente", "cliente"),
            "texto": sanitizar_html(filtrar_telefonos(m.get("texto", ""))),
            "imagen_url": m.get("imagen_url", ""),
            "archivo_url": m.get("archivo_url", ""),
            "archivo_nombre": sanitizar_html(m.get("archivo_nombre", "")),
            "archivo_tipo": m.get("archivo_tipo", ""),
            "fecha": m["fecha"].isoformat() if isinstance(m.get("fecha"), datetime) else "",
            "leido": m.get("leido", True)
        })

    # Datos del pedido para contexto
    pedido_info = {
        "id": str(pedido["_id"]),
        "negocio_nombre": pedido.get("negocio_nombre", ""),
        "estado": pedido.get("estado", "recibido"),
        "total": pedido.get("total", 0),
        "metodo_entrega": pedido.get("metodo_entrega", "retiro"),
        "metodo_pago": pedido.get("metodo_pago", "efectivo"),
        "cliente_nombre": pedido.get("cliente_nombre", "Cliente"),
        "items": pedido.get("items", [])
    }

    return jsonify({"mensajes": resultado, "pedido": pedido_info})


@chat_bp.route('/api/chat/<pedido_id>/enviar', methods=['POST'])
@_rate_limit('chat_enviar')
def chat_enviar(pedido_id):
    """Envía un mensaje al chat de un pedido"""
    if not validar_objectid(pedido_id):
        return jsonify({"error": "ID inválido"}), 400

    pedido = db.pedidos.find_one({"_id": ObjectId(pedido_id)})
    if not pedido:
        return jsonify({"error": "Pedido no encontrado"}), 404

    # Verificar permisos: cliente, vendedor o repartidor asociado
    es_cliente = session.get('cliente_id') and str(session['cliente_id']) == str(pedido.get('cliente_id', ''))
    es_vendedor = session.get('negocio_slug') and str(pedido.get('negocio_slug', '')) == session['negocio_slug']
    # S4 FIX: Repartidor asociado también puede enviar mensajes al chat
    es_repartidor = False
    if session.get('repartidor_id') and validar_objectid(session['repartidor_id']) and not es_cliente and not es_vendedor:
        rep = db.repartidores.find_one({"_id": ObjectId(session['repartidor_id'])})
        if rep and rep.get('activo'):
            negocio_id_str = str(pedido.get('negocio_id', ''))
            es_repartidor = any(str(n.get('negocio_id', '')) == negocio_id_str for n in rep.get('negocios', []))
    if not es_cliente and not es_vendedor and not es_repartidor:
        return jsonify({"error": "No autorizado"}), 403

    data = request.json or {}
    texto = data.get('texto', '').strip()
    imagen_url = data.get('imagen_url', '').strip()

    # Sanitizar HTML para prevenir XSS y filtrar números de teléfono
    texto_sanitizado = sanitizar_html(texto)
    texto_filtrado = filtrar_telefonos(texto_sanitizado)

    if not texto_filtrado and not imagen_url:
        return jsonify({"error": "Mensaje vacío"}), 400

    if es_vendedor:
        remitente = "vendedor"
    elif es_repartidor:
        remitente = "repartidor"
    else:
        remitente = "cliente"

    # Detectar si se filtró un teléfono para avisar al frontend
    telefono_detectado = texto_filtrado != texto_sanitizado

    nuevo_mensaje = {
        "pedido_id": pedido_id,
        "remitente": remitente,
        "texto": texto_filtrado,
        "imagen_url": imagen_url,
        "fecha": datetime.now(),
        "leido": False
    }

    try:
        result = db.chat_mensajes.insert_one(nuevo_mensaje)

        # Notificar por push
        neg = db.negocios.find_one({"_id": pedido["negocio_id"]})
        if remitente == "vendedor" and pedido.get("cliente_id"):
            enviar_push_cliente(
                pedido.get("cliente_id"),
                f"💬 {neg.get('nombre', 'NortFood') if neg else 'NortFood'}",
                texto_filtrado[:60] if texto_filtrado else "📎 Imagen adjunta",
                url='/', type='new_message', chatId=pedido_id
            )
        elif remitente == "cliente":
            if neg:
                enviar_push_negocio(
                    neg,
                    f"💬 {pedido.get('cliente_nombre', 'Cliente')}",
                    texto_filtrado[:60] if texto_filtrado else "📎 Imagen adjunta",
                    url=f"/{neg['slug']}/pedidos",
                    type='new_message',
                    chatId=pedido_id
                )
            # Si el pedido es delivery y está en camino, notificar al repartidor también
            if pedido.get("metodo_entrega") == "domicilio" and pedido.get("estado") == "en_camino":
                enviar_push_repartidores(
                    pedido["negocio_id"],
                    f"💬 Mensaje de {pedido.get('cliente_nombre', 'Cliente')}",
                    texto_filtrado[:60] if texto_filtrado else "📎 Imagen adjunta",
                    url="/repartidor/panel",
                    type='new_message',
                    chatId=pedido_id,
                    orderId=str(pedido_id)
                )

        respuesta = {"success": True, "mensaje_id": str(result.inserted_id)}
        if telefono_detectado:
            respuesta["telefono_filtrado"] = True
        return jsonify(respuesta), 201
    except Exception as e:
        current_app.logger.error(f"Error guardando mensaje: {e}")
        return jsonify({"error": "Error al guardar mensaje"}), 500


@chat_bp.route('/api/chat/<pedido_id>/subir-imagen', methods=['POST'])
def chat_subir_imagen(pedido_id):
    """Sube una imagen o PDF al chat de un pedido (comprobante de pago, etc)"""
    if not validar_objectid(pedido_id):
        return jsonify({"error": "ID inválido"}), 400

    pedido = db.pedidos.find_one({"_id": ObjectId(pedido_id)})
    if not pedido:
        return jsonify({"error": "Pedido no encontrado"}), 404

    es_cliente = session.get('cliente_id') and str(session['cliente_id']) == str(pedido.get('cliente_id', ''))
    es_vendedor = session.get('negocio_slug') and str(pedido.get('negocio_slug', '')) == session['negocio_slug']
    # S4 FIX: Repartidor asociado también puede subir imágenes al chat
    es_repartidor = False
    if session.get('repartidor_id') and validar_objectid(session['repartidor_id']) and not es_cliente and not es_vendedor:
        rep = db.repartidores.find_one({"_id": ObjectId(session['repartidor_id'])})
        if rep and rep.get('activo'):
            negocio_id_str = str(pedido.get('negocio_id', ''))
            es_repartidor = any(str(n.get('negocio_id', '')) == negocio_id_str for n in rep.get('negocios', []))
    if not es_cliente and not es_vendedor and not es_repartidor:
        return jsonify({"error": "No autorizado"}), 403

    archivo = request.files.get('imagen') or request.files.get('archivo')
    if not archivo or not archivo.filename:
        return jsonify({"error": "No se envió archivo"}), 400

    # Verificar extensión (imágenes + PDF)
    if not extension_chat_permitida(archivo.filename):
        return jsonify({"error": "Formato no permitido. Solo imágenes y PDF."}), 400

    try:
        ext = archivo.filename.rsplit('.', 1)[1].lower()
        es_pdf = ext == 'pdf'

        if es_pdf:
            # Subir PDF como archivo raw a Cloudinary
            res = cloudinary.uploader.upload(
                archivo, folder=f"chat/{pedido_id}",
                overwrite=True, resource_type="raw",
                type="upload"
            )
            url = res.get('secure_url')
        else:
            url = subir_imagen_cloudinary(archivo, f"chat/{pedido_id}")

        if url:
            if es_vendedor:
                remitente = "vendedor"
            elif es_repartidor:
                remitente = "repartidor"
            else:
                remitente = "cliente"
            nuevo_mensaje = {
                "pedido_id": pedido_id,
                "remitente": remitente,
                "texto": "",
                "imagen_url": url if not es_pdf else "",
                "archivo_url": url if es_pdf else "",
                "archivo_nombre": sanitizar_html(archivo.filename) if es_pdf else "",
                "archivo_tipo": "pdf" if es_pdf else "",
                "fecha": datetime.now(),
                "leido": False
            }
            db.chat_mensajes.insert_one(nuevo_mensaje)
            return jsonify({"success": True, "imagen_url": url, "archivo_url": url if es_pdf else ""}), 201
        else:
            return jsonify({"error": "Error al subir archivo"}), 500
    except Exception as e:
        current_app.logger.error(f"Error subiendo archivo al chat: {e}")
        return jsonify({"error": "Error interno"}), 500


@chat_bp.route('/share-target', methods=['GET', 'POST'])
def share_target():
    """Web Share Target API: recibe archivos compartidos desde otras apps (MP, NX, etc)"""
    if not session.get('cliente_id'):
        return redirect('/')

    if request.method == 'GET':
        # Mostrar página para elegir a qué pedido enviar el comprobante
        pedidos = list(db.pedidos.find({
            "cliente_id": session['cliente_id'],
            "estado": {"$nin": ["entregado", "cancelado"]}
        }).sort("fecha", -1))
        shared_text = request.args.get('text', '') or request.args.get('title', '')
        shared_url = request.args.get('url', '')
        return render_template('share_target.html', pedidos=pedidos, shared_text=shared_text, shared_url=shared_url)

    # POST: recibir el archivo compartido
    pedido_id = request.form.get('pedido_id', '').strip()
    if not pedido_id or not validar_objectid(pedido_id):
        return jsonify({"error": "Pedido no especificado"}), 400

    pedido = db.pedidos.find_one({"_id": ObjectId(pedido_id)})
    if not pedido or str(pedido.get('cliente_id', '')) != str(session['cliente_id']):
        return jsonify({"error": "Pedido no válido"}), 403

    # Verificar si hay texto/URL compartidos (Web Share Target API)
    shared_text = request.form.get('text', '') or request.form.get('title', '')
    shared_url = request.form.get('url', '')

    archivo = request.files.get('archivo') or request.files.get('imagen')

    # Si no hay archivo pero hay texto compartido, enviar como mensaje de texto
    if (not archivo or not archivo.filename) and shared_text:
        texto_msg = sanitizar_html(filtrar_telefonos(shared_text))
        if shared_url:
            texto_msg += f"\n{sanitizar_html(shared_url)}"
        nuevo_mensaje = {
            "pedido_id": pedido_id,
            "remitente": "cliente",
            "texto": texto_msg,
            "imagen_url": "",
            "fecha": datetime.now(),
            "leido": False
        }
        try:
            db.chat_mensajes.insert_one(nuevo_mensaje)
            return redirect(f'/?comprobante_enviado=1')
        except Exception as e:
            current_app.logger.error(f"Error en share target (texto): {e}")
            return jsonify({"error": "Error interno"}), 500

    if not archivo or not archivo.filename:
        return jsonify({"error": "No se recibió archivo"}), 400

    if not extension_chat_permitida(archivo.filename):
        return jsonify({"error": "Formato no permitido"}), 400

    try:
        ext = archivo.filename.rsplit('.', 1)[1].lower()
        es_pdf = ext == 'pdf'

        if es_pdf:
            res = cloudinary.uploader.upload(
                archivo, folder=f"chat/{pedido_id}",
                overwrite=True, resource_type="raw", type="upload"
            )
            url = res.get('secure_url')
        else:
            url = subir_imagen_cloudinary(archivo, f"chat/{pedido_id}")

        if url:
            # Incluir texto/URL compartidos en el mensaje si existen
            texto_extra = ""
            if shared_text:
                texto_extra = sanitizar_html(filtrar_telefonos(shared_text))
            if shared_url:
                texto_extra += f"\n{sanitizar_html(shared_url)}" if texto_extra else sanitizar_html(shared_url)

            nuevo_mensaje = {
                "pedido_id": pedido_id,
                "remitente": "cliente",
                "texto": texto_extra.strip(),
                "imagen_url": url if not es_pdf else "",
                "archivo_url": url if es_pdf else "",
                "archivo_nombre": sanitizar_html(archivo.filename) if es_pdf else "",
                "archivo_tipo": "pdf" if es_pdf else "",
                "fecha": datetime.now(),
                "leido": False
            }
            db.chat_mensajes.insert_one(nuevo_mensaje)
            return redirect(f'/?comprobante_enviado=1')
        else:
            return jsonify({"error": "Error al subir"}), 500
    except Exception as e:
        current_app.logger.error(f"Error en share target: {e}")
        return jsonify({"error": "Error interno"}), 500


@chat_bp.route('/api/chat/no-leidos')
def chat_no_leidos():
    """Devuelve cantidad de mensajes no leídos para el cliente o vendedor"""
    if session.get('cliente_id'):
        # Contar pedidos activos del cliente con mensajes no leídos del vendedor
        pedidos_ids = [str(p["_id"]) for p in db.pedidos.find(
            {"cliente_id": session['cliente_id'], "estado": {"$nin": ["entregado", "cancelado"]}},
            {"_id": 1}
        )]
        count = db.chat_mensajes.count_documents({
            "pedido_id": {"$in": pedidos_ids},
            "remitente": "vendedor",
            "leido": False
        })
        return jsonify({"no_leidos": count, "pedidos_activos": len(pedidos_ids)})

    elif session.get('negocio_slug'):
        negocio = db.negocios.find_one({"slug": session['negocio_slug']})
        if not negocio:
            return jsonify({"error": "No autorizado"}), 403
        pedidos_ids = [str(p["_id"]) for p in db.pedidos.find(
            {"negocio_id": negocio["_id"], "estado": {"$nin": ["entregado", "cancelado"]}},
            {"_id": 1}
        )]
        count = db.chat_mensajes.count_documents({
            "pedido_id": {"$in": pedidos_ids},
            "remitente": "cliente",
            "leido": False
        })
        return jsonify({"no_leidos": count, "pedidos_activos": len(pedidos_ids)})

    return jsonify({"no_leidos": 0, "pedidos_activos": 0})
