"""
NortFood - Configuración Blueprint
====================================
Rutas de configuración del negocio: datos generales,
zona de delivery, logo, horarios y código de repartidor.
"""
import re

from flask import (
    Blueprint, request, jsonify,
    redirect, url_for, session, flash, current_app
)

from extensions import db
from helpers import subir_imagen_cloudinary, validar_hora, generar_codigo_repartidor
from decorators import requiere_negocio_propietario

configuracion_bp = Blueprint('configuracion', __name__)


# ============================================
# CONFIGURACION DEL NEGOCIO
# ============================================

@configuracion_bp.route('/update-config/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def update_config(slug_negocio):
    nombre = request.form.get('nombre', '').strip()
    if not nombre:
        flash("El nombre del negocio es obligatorio", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    whatsapp = request.form.get('whatsapp', '').strip()
    if whatsapp and not re.match(r'^[0-9+ ]{6,20}$', whatsapp):
        flash("Formato de WhatsApp invalido", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    update_data = {
        "nombre": nombre, "whatsapp": whatsapp,
        "mensaje_bienvenida": request.form.get('mensaje', '').strip(),
        "color_principal": request.form.get('color', '').strip() or "#38b087",
        "ofrece_delivery": request.form.get('ofrece_delivery') in ('on', 'true', '1'),
        "acepta_transferencia": request.form.get('acepta_transferencia') in ('on', 'true', '1'),
        "alias_bancario": request.form.get('alias_bancario', '').strip(),
        "logo_en_circulo": request.form.get('logo_en_circulo') in ('on', 'true', '1'),
        "color_circulo_logo": request.form.get('color_circulo_logo', '').strip() or "#ffffff",
        "color_fondo": request.form.get('color_fondo', '').strip() or "#f4f9f4",
        "instagram": request.form.get('instagram', '').strip(),
        "facebook": request.form.get('facebook', '').strip(),
    }
    # Tolerancia de cancelación (minutos que tiene el cliente para cancelar)
    try:
        tolerancia = int(request.form.get('tolerancia_cancelacion', 5))
        tolerancia = max(0, min(60, tolerancia))  # Entre 0 y 60 minutos
    except (ValueError, TypeError):
        tolerancia = 5
    update_data["tolerancia_cancelacion"] = tolerancia

    # Tiempo de entrega estimado (minutos)
    try:
        tiempo_entrega = int(request.form.get('tiempo_entrega', 0))
        tiempo_entrega = max(0, min(180, tiempo_entrega))  # Entre 0 y 180 minutos
    except (ValueError, TypeError):
        tiempo_entrega = 0
    update_data["tiempo_entrega"] = tiempo_entrega

    # Generar código de repartidor si el local ofrece delivery y no tiene uno
    negocio_actual = db.negocios.find_one({"slug": slug_negocio})
    if update_data.get("ofrece_delivery") and not negocio_actual.get("repartidor_codigo"):
        update_data["repartidor_codigo"] = generar_codigo_repartidor()

    for campo_url in ['instagram', 'facebook']:
        url_val = update_data.get(campo_url, '')
        if url_val and not url_val.startswith(('http://', 'https://')): update_data[campo_url] = ''
    if request.form.get('eliminar_banner'): update_data["banner_url"] = ""
    banner = request.files.get('banner')
    if banner and banner.filename:
        url = subir_imagen_cloudinary(banner, f"banners/{slug_negocio}")
        if url: update_data["banner_url"] = url
    if request.form.get('eliminar_fondo'): update_data["fondo_imagen_url"] = ""
    fondo_img = request.files.get('fondo_imagen')
    if fondo_img and fondo_img.filename:
        url = subir_imagen_cloudinary(fondo_img, f"fondos/{slug_negocio}")
        if url: update_data["fondo_imagen_url"] = url
    try:
        db.negocios.update_one({"slug": slug_negocio}, {"$set": update_data})
    except Exception as e:
        current_app.logger.error(f"Error actualizando configuracion: {e}")
        flash("Error al guardar la configuracion", "error")
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


@configuracion_bp.route('/api/zona-delivery/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def guardar_zona_delivery(slug_negocio):
    """Guardar las zonas de delivery del negocio (múltiples polígonos con precio)"""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Datos inválidos"}), 400

    zonas = data.get("zonas_delivery", [])
    zona_activa = data.get("zona_delivery_activa", False)

    # Filtrar zonas vacías (sin puntos dibujados) - se guardan solo las que tienen puntos
    if zonas and isinstance(zonas, list):
        zonas = [z for z in zonas if isinstance(z, dict) and len(z.get("puntos", [])) >= 3]

    # Validar las zonas que quedaron
    for i, zona in enumerate(zonas):
        puntos = zona.get("puntos", [])
        for punto in puntos:
            if not isinstance(punto, list) or len(punto) != 2:
                return jsonify({"error": f"Cada punto en zona '{zona.get('nombre', i+1)}' debe ser [latitud, longitud]"}), 400

    try:
        update_fields = {
            "zonas_delivery": zonas,
            "zona_delivery_activa": bool(zona_activa)
        }
        # Si hay zonas nuevas, también actualizar zona_delivery para compatibilidad
        if zonas and len(zonas) > 0:
            update_fields["zona_delivery"] = zonas[0].get("puntos", [])
            update_fields["precio_delivery"] = zonas[0].get("precio", 0)
        else:
            update_fields["zona_delivery"] = []
            update_fields["precio_delivery"] = 0

        db.negocios.update_one(
            {"slug": slug_negocio},
            {"$set": update_fields}
        )
        return jsonify({"ok": True, "mensaje": "Zonas de delivery guardadas"})
    except Exception as e:
        current_app.logger.error(f"Error guardando zonas delivery: {e}")
        return jsonify({"error": "Error al guardar"}), 500


@configuracion_bp.route('/update-logo/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def update_logo(slug_negocio):
    logo = request.files.get('logo')
    if logo and logo.filename:
        url = subir_imagen_cloudinary(logo, f"logos/{slug_negocio}")
        if url: db.negocios.update_one({"slug": slug_negocio}, {"$set": {"logo_url": url}})
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


@configuracion_bp.route('/update-horarios/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def update_horarios(slug_negocio):
    horarios = {}
    for d in ['1', '2', '3', '4', '5', '6', '7']:
        horarios[d] = {
            "abierto": request.form.get(f'dia_{d}_abierto') in ('on', 'true', '1'),
            "apertura": validar_hora(request.form.get(f'dia_{d}_apertura', '09:00'), '09:00'),
            "cierre": validar_hora(request.form.get(f'dia_{d}_cierre', '13:00'), '13:00'),
            "turno2": request.form.get(f'dia_{d}_turno2') in ('on', 'true', '1'),
            "apertura2": validar_hora(request.form.get(f'dia_{d}_apertura2', '17:00'), '17:00'),
            "cierre2": validar_hora(request.form.get(f'dia_{d}_cierre2', '21:00'), '21:00')
        }
    db.negocios.update_one({"slug": slug_negocio}, {"$set": {"horarios": horarios}})
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


@configuracion_bp.route('/api/repartidor/regenerar-codigo', methods=['POST'])
def regenerar_codigo_repartidor():
    """Regenera el código de repartidor del local"""
    if not session.get('negocio_slug'):
        return jsonify({"error": "No autorizado"}), 403
    slug = session['negocio_slug']
    nuevo_codigo = generar_codigo_repartidor()
    db.negocios.update_one({"slug": slug}, {"$set": {"repartidor_codigo": nuevo_codigo}})
    return jsonify({"success": True, "nuevo_codigo": nuevo_codigo})
