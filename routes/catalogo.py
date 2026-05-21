"""
NortFood - Catálogo Blueprint
====================================
Rutas de visualización y gestión del catálogo de productos,
agregados, ingredientes, categorías y secciones del negocio.
"""
import os
import json

from flask import (
    Blueprint, render_template, request, jsonify,
    redirect, url_for, session, flash, abort, current_app
)

from bson.objectid import ObjectId

from extensions import db, CLOUDINARY_CLOUD_NAME
from helpers import validar_objectid, subir_imagen_cloudinary, extraer_descuento_form
from decorators import requiere_negocio, requiere_negocio_propietario

catalogo_bp = Blueprint('catalogo', __name__)


# ============================================
# PÁGINA PRINCIPAL DEL CATÁLOGO / NEGOCIO
# ============================================

@catalogo_bp.route('/<slug_negocio>')
def index(slug_negocio):
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio:
        abort(404)

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
                {"slug": slug_negocio},
                {"$set": {"zonas_delivery": zonas_nuevas}}
            )
            negocio['zonas_delivery'] = zonas_nuevas

    if not negocio.get("aprobado", False):
        return render_template('en_revision.html'), 403

    if negocio.get("suspendido", False):
        return render_template('error.html', codigo=403,
                               mensaje="Este negocio se encuentra suspendido temporalmente"), 403

    vencimiento = negocio.get("plan_vencimiento")
    if vencimiento:
        from datetime import datetime
        if isinstance(vencimiento, str):
            try:
                vencimiento_dt = datetime.strptime(vencimiento, '%Y-%m-%d')
            except ValueError:
                vencimiento_dt = None
        elif isinstance(vencimiento, datetime):
            vencimiento_dt = vencimiento
        else:
            vencimiento_dt = None

        if vencimiento_dt and vencimiento_dt < datetime.now():
            return render_template('error.html', codigo=403,
                                   mensaje="El plan de este negocio ha vencido. Contactá al administrador."), 403

    productos_lista = list(db.productos.find({"negocio_id": negocio["_id"]}))
    agregados_lista = list(db.agregados.find({"negocio_id": negocio["_id"]}))
    ingredientes_lista = list(db.ingredientes.find({"negocio_id": negocio["_id"]}))

    negocio_id_str = str(negocio["_id"])
    agregados_categorias = negocio.get('agregados_categorias', [])
    ingredientes_categorias = negocio.get('ingredientes_categorias', [])
    secciones_catalogo = negocio.get('secciones_catalogo', [])
    # Convertir ObjectIds de productos en secciones a strings para JSON
    for sec in secciones_catalogo:
        if 'productos' in sec:
            sec['productos'] = [str(pid) for pid in sec['productos'] if pid]

    # Obtener reseñas (las más recientes primero)
    resenas_lista = list(db.resenas.find({"negocio_id": negocio["_id"]}).sort("fecha", -1))
    # Preparar datos de reseñas para el template (convertir ObjectId a string, fechas)
    for res in resenas_lista:
        res['_id'] = str(res['_id'])
        res['negocio_id'] = str(res['negocio_id'])
        res['cliente_id'] = str(res['cliente_id'])
        if res.get('fecha'):
            res['fecha_str'] = res['fecha'].strftime('%d/%m/%Y')
        # Asegurar que las categorías existan (compatibilidad con reseñas viejas)
        if res.get('rapidez') is None:
            res['rapidez'] = None
        if res.get('calidad') is None:
            res['calidad'] = None
        if res.get('precio') is None:
            res['precio'] = None

    return render_template('index.html', negocio=negocio, productos=productos_lista,
                           agregados=agregados_lista, negocio_id_str=negocio_id_str,
                           agregados_categorias=agregados_categorias, resenas=resenas_lista,
                           secciones_catalogo=secciones_catalogo,
                           ingredientes=ingredientes_lista,
                           ingredientes_categorias=ingredientes_categorias,
                           cloud_name=CLOUDINARY_CLOUD_NAME,
                           upload_preset=os.getenv("CLOUDINARY_UPLOAD_PRESET", ""))


# ============================================
# API ENDPOINTS (JSON)
# ============================================

@catalogo_bp.route('/api/producto/<id>')
def api_producto(id):
    if not validar_objectid(id):
        return jsonify({"error": "ID invalido"}), 400
    producto = db.productos.find_one({"_id": ObjectId(id)})
    if not producto:
        return jsonify({"error": "Producto no encontrado"}), 404
    # S1 FIX: Solo devolver campos públicos, no el documento interno de MongoDB
    # que puede contener negocio_id, agregados_ids, ingredientes_ids, etc.
    producto_publico = {
        "id": str(producto["_id"]),
        "nombre": producto.get("nombre", ""),
        "precio": producto.get("precio", 0),
        "imagen_url": producto.get("imagen_url", ""),
        "imagenes_extra": producto.get("imagenes_extra", []),
        "categoria": producto.get("categoria", ""),
        "stock": producto.get("stock", True),
        "descuento_activo": producto.get("descuento_activo", False),
        "tipo_descuento": producto.get("tipo_descuento", "porcentaje"),
        "valor_descuento": producto.get("valor_descuento", 0),
        "precio_promo": producto.get("precio_promo"),
        "descripcion": producto.get("descripcion", ""),
        "talles": producto.get("talles", []),
        "colores": producto.get("colores", []),
        "material": producto.get("material", ""),
        "genero": producto.get("genero", ""),
        "secciones": producto.get("secciones", []),
        "recomendados": producto.get("recomendados", []),
    }
    return jsonify(producto_publico)


# ============================================
# GESTION DE AGREGADOS (GLOBAL)
# ============================================

@catalogo_bp.route('/agregar-agregado/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def agregar_agregado(slug_negocio):
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    nombre = request.form.get('nombre', '').strip()
    precio_str = request.form.get('precio', '').strip()
    categoria = request.form.get('categoria', '').strip()
    if not nombre:
        flash("El nombre del agregado es obligatorio", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    try:
        precio = float(precio_str)
        if precio < 0: raise ValueError("Precio negativo")
    except (ValueError, TypeError):
        flash("El precio debe ser un numero valido y positivo", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    imagen_url = ""
    foto = request.files.get('foto')
    if foto and foto.filename: imagen_url = subir_imagen_cloudinary(foto, f"agregados/{slug_negocio}") or ""
    nuevo_agregado = {"nombre": nombre, "precio": precio, "categoria": categoria, "imagen_url": imagen_url,
                      "negocio_id": negocio["_id"]}
    try:
        db.agregados.insert_one(nuevo_agregado)
    except Exception as e:
        current_app.logger.error(f"Error insertando agregado: {e}")
        flash("Error al guardar el agregado en la base de datos", "error")
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


@catalogo_bp.route('/editar-agregado/<id>', methods=['POST'])
@requiere_negocio
def editar_agregado(id):
    if not validar_objectid(id): abort(400)
    agregado = db.agregados.find_one({"_id": ObjectId(id)})
    if not agregado: abort(404)
    negocio = db.negocios.find_one({"_id": agregado["negocio_id"]})
    if not negocio or session.get('negocio_slug') != negocio['slug']: abort(403)
    nombre = request.form.get('nombre', '').strip()
    precio_str = request.form.get('precio', '').strip()
    categoria = request.form.get('categoria', '').strip()
    if not nombre:
        flash("El nombre del agregado es obligatorio", "error")
        return redirect(url_for('catalogo.index', slug_negocio=negocio['slug']))
    try:
        precio = float(precio_str)
        if precio < 0: raise ValueError("Precio negativo")
    except (ValueError, TypeError):
        flash("El precio debe ser un numero valido y positivo", "error")
        return redirect(url_for('catalogo.index', slug_negocio=negocio['slug']))
    update_data = {"nombre": nombre, "precio": precio, "categoria": categoria}
    foto = request.files.get('foto')
    if foto and foto.filename:
        url = subir_imagen_cloudinary(foto, f"agregados/{negocio['slug']}")
        if url: update_data["imagen_url"] = url
    if request.form.get('eliminar_foto'): update_data["imagen_url"] = ""
    try:
        db.agregados.update_one({"_id": ObjectId(id)}, {"$set": update_data})
    except Exception as e:
        current_app.logger.error(f"Error actualizando agregado: {e}")
        flash("Error al actualizar el agregado", "error")
    return redirect(url_for('catalogo.index', slug_negocio=negocio['slug']))


@catalogo_bp.route('/eliminar-agregado/<id>', methods=['POST'])
@requiere_negocio
def eliminar_agregado(id):
    if not validar_objectid(id): abort(400)
    agregado = db.agregados.find_one({"_id": ObjectId(id)})
    if not agregado: abort(404)
    negocio = db.negocios.find_one({"_id": agregado["negocio_id"]})
    if not negocio or session.get('negocio_slug') != negocio['slug']: abort(403)
    try:
        db.agregados.delete_one({"_id": ObjectId(id)})
        db.productos.update_many({"negocio_id": negocio["_id"]}, {"$pull": {"agregados_ids": str(id)}})
    except Exception as e:
        current_app.logger.error(f"Error eliminando agregado: {e}")
        flash("Error al eliminar el agregado", "error")
    return redirect(url_for('catalogo.index', slug_negocio=negocio['slug']))


@catalogo_bp.route('/agregar-categoria-agregado/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def agregar_categoria_agregado(slug_negocio):
    nombre_cat = request.form.get('nombre_categoria_agregado', '').strip()
    if not nombre_cat:
        flash("El nombre de la categoria de agregado es obligatorio", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    categorias = negocio.get('agregados_categorias', [])
    if nombre_cat.lower() in [c.lower() for c in categorias]:
        flash("Esta categoria de agregado ya existe", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    db.negocios.update_one({"slug": slug_negocio}, {"$push": {"agregados_categorias": nombre_cat}})
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


@catalogo_bp.route('/eliminar-categoria-agregado/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def eliminar_categoria_agregado(slug_negocio):
    nombre_cat = request.form.get('nombre', '').strip()
    if not nombre_cat:
        flash("Nombre de categoria de agregado requerido", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    db.agregados.update_many({"negocio_id": negocio["_id"], "categoria": nombre_cat}, {"$set": {"categoria": ""}})
    db.negocios.update_one({"slug": slug_negocio}, {"$pull": {"agregados_categorias": nombre_cat}})
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


# ============================================
# GESTION DE INGREDIENTES (GLOBAL, como agregados)
# ============================================

@catalogo_bp.route('/agregar-ingrediente/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def agregar_ingrediente(slug_negocio):
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    nombre = request.form.get('nombre', '').strip()
    categoria = request.form.get('categoria', '').strip()
    if not nombre:
        flash("El nombre del ingrediente es obligatorio", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    imagen_url = ""
    foto = request.files.get('foto')
    if foto and foto.filename:
        imagen_url = subir_imagen_cloudinary(foto, f"ingredientes/{slug_negocio}") or ""
    nuevo_ingrediente = {"nombre": nombre, "categoria": categoria, "imagen_url": imagen_url, "negocio_id": negocio["_id"]}
    try:
        db.ingredientes.insert_one(nuevo_ingrediente)
    except Exception as e:
        current_app.logger.error(f"Error insertando ingrediente: {e}")
        flash("Error al guardar el ingrediente en la base de datos", "error")
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


@catalogo_bp.route('/editar-ingrediente/<id>', methods=['POST'])
@requiere_negocio
def editar_ingrediente(id):
    if not validar_objectid(id): abort(400)
    ingrediente = db.ingredientes.find_one({"_id": ObjectId(id)})
    if not ingrediente: abort(404)
    negocio = db.negocios.find_one({"_id": ingrediente["negocio_id"]})
    if not negocio or session.get('negocio_slug') != negocio['slug']: abort(403)
    nombre = request.form.get('nombre', '').strip()
    categoria = request.form.get('categoria', '').strip()
    if not nombre:
        flash("El nombre del ingrediente es obligatorio", "error")
        return redirect(url_for('catalogo.index', slug_negocio=negocio['slug']))
    update_data = {"nombre": nombre, "categoria": categoria}
    foto = request.files.get('foto')
    if foto and foto.filename:
        url_img = subir_imagen_cloudinary(foto, f"ingredientes/{negocio['slug']}")
        if url_img: update_data["imagen_url"] = url_img
    if request.form.get('eliminar_foto'): update_data["imagen_url"] = ""
    try:
        db.ingredientes.update_one({"_id": ObjectId(id)}, {"$set": update_data})
    except Exception as e:
        current_app.logger.error(f"Error actualizando ingrediente: {e}")
        flash("Error al actualizar el ingrediente", "error")
    return redirect(url_for('catalogo.index', slug_negocio=negocio['slug']))


@catalogo_bp.route('/eliminar-ingrediente/<id>', methods=['POST'])
@requiere_negocio
def eliminar_ingrediente(id):
    if not validar_objectid(id): abort(400)
    ingrediente = db.ingredientes.find_one({"_id": ObjectId(id)})
    if not ingrediente: abort(404)
    negocio = db.negocios.find_one({"_id": ingrediente["negocio_id"]})
    if not negocio or session.get('negocio_slug') != negocio['slug']: abort(403)
    try:
        db.ingredientes.delete_one({"_id": ObjectId(id)})
        db.productos.update_many({"negocio_id": negocio["_id"]}, {"$pull": {"ingredientes_ids": str(id)}})
    except Exception as e:
        current_app.logger.error(f"Error eliminando ingrediente: {e}")
        flash("Error al eliminar el ingrediente", "error")
    return redirect(url_for('catalogo.index', slug_negocio=negocio['slug']))


@catalogo_bp.route('/agregar-categoria-ingrediente/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def agregar_categoria_ingrediente(slug_negocio):
    nombre_cat = request.form.get('nombre_categoria_ingrediente', '').strip()
    if not nombre_cat:
        flash("El nombre de la categoria de ingrediente es obligatorio", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    categorias = negocio.get('ingredientes_categorias', [])
    if nombre_cat.lower() in [c.lower() for c in categorias]:
        flash("Esta categoria de ingrediente ya existe", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    db.negocios.update_one({"slug": slug_negocio}, {"$push": {"ingredientes_categorias": nombre_cat}})
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


@catalogo_bp.route('/eliminar-categoria-ingrediente/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def eliminar_categoria_ingrediente(slug_negocio):
    nombre_cat = request.form.get('nombre', '').strip()
    if not nombre_cat:
        flash("Nombre de categoria de ingrediente requerido", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    db.ingredientes.update_many({"negocio_id": negocio["_id"], "categoria": nombre_cat}, {"$set": {"categoria": ""}})
    db.negocios.update_one({"slug": slug_negocio}, {"$pull": {"ingredientes_categorias": nombre_cat}})
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


# ============================================
# GESTION DE PRODUCTOS
# ============================================

@catalogo_bp.route('/agregar-producto/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def agregar_producto(slug_negocio):
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    nombre = request.form.get('nombre', '').strip()
    precio_str = request.form.get('precio', '').strip()
    categoria = request.form.get('categoria', '').strip() or "Sin Categoria"
    if not nombre:
        flash("El nombre del producto es obligatorio", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    try:
        precio = float(precio_str)
        if precio < 0: raise ValueError("Precio negativo")
    except (ValueError, TypeError):
        flash("El precio debe ser un numero valido y positivo", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    fotos = request.files.getlist('fotos')
    imagenes_urls = []
    # Prioridad 1: leer orden_imagenes (imagenes ya subidas via browser + nuevas por backend)
    orden_json = request.form.get('orden_imagenes')
    if orden_json:
        try:
            orden = json.loads(orden_json)
            for item in orden:
                if item.get('tipo') == 'existente':
                    url = item.get('url', '')
                    if url and url.startswith(
                        f"https://res.cloudinary.com/{CLOUDINARY_CLOUD_NAME}/"): imagenes_urls.append(url)
                elif item.get('tipo') == 'nueva':
                    idx = item.get('indice')
                    if isinstance(idx, int) and idx < len(fotos):
                        url = subir_imagen_cloudinary(fotos[idx], f"productos/{slug_negocio}")
                        if url: imagenes_urls.append(url)
        except Exception as e:
            current_app.logger.error(f"Error procesando imagenes en agregar: {e}")
    # Fallback: si no hay orden_imagenes, subir archivos directamente (compatibilidad)
    if not imagenes_urls and fotos:
        for foto in fotos:
            url = subir_imagen_cloudinary(foto, f"productos/{slug_negocio}")
            if url: imagenes_urls.append(url)
    # Descuento — buscar con múltiples variantes de nombres (nuevo-*, descuento-activo, etc.)
    descuento_activo, tipo_descuento, valor_descuento = extraer_descuento_form(request.form, prefix='nuevo')
    # Si no se encontró con prefijo, intentar sin prefijo
    if not descuento_activo:
        descuento_activo, tipo_descuento, valor_descuento = extraer_descuento_form(request.form, prefix=None)
    precio_promo = None
    if descuento_activo:
        # Calcular precio con descuento
        if tipo_descuento == 'porcentaje':
            valor_descuento = min(valor_descuento, 100)
            precio_promo = round(precio * (1 - valor_descuento / 100), 2)
        else:  # monto fijo
            valor_descuento = min(valor_descuento, precio)
            precio_promo = round(precio - valor_descuento, 2)
        if precio_promo < 0: precio_promo = 0
    nuevo_producto = {
        "nombre": nombre, "precio": precio, "categoria": categoria,
        "imagen_url": imagenes_urls[0] if imagenes_urls else "", "imagenes_extra": imagenes_urls,
        "negocio_id": negocio["_id"], "stock": request.form.get('stock') in ('on', 'true', '1'),
        "descuento_activo": descuento_activo,
        "tipo_descuento": tipo_descuento if descuento_activo else 'porcentaje',
        "valor_descuento": valor_descuento if descuento_activo else 0,
        "precio_promo": precio_promo
    }
    rubro = negocio.get('rubro')
    if rubro == 'ropa':
        talles_std = request.form.getlist('talles_std')
        talles_custom = [t.strip() for t in request.form.get('talles_custom', '').split(',') if t.strip()]
        nuevo_producto['talles'] = talles_std + talles_custom
        nuevo_producto['colores'] = [c.strip() for c in request.form.get('colores', '').split(',') if c.strip()]
        nuevo_producto['material'] = request.form.get('material', '').strip()
        nuevo_producto['genero'] = request.form.get('genero', '').strip()
    elif rubro == 'restaurante':
        nuevo_producto['descripcion'] = request.form.get('descripcion', '').strip()
        nuevo_producto['agregados_ids'] = [aid for aid in request.form.getlist('agregados_ids') if
                                           validar_objectid(aid)]
        nuevo_producto['ingredientes_ids'] = [iid for iid in request.form.getlist('ingredientes_ids') if
                                              validar_objectid(iid)]
        try:
            nuevo_producto['secciones'] = json.loads(request.form.get('secciones', '[]'))
        except:
            nuevo_producto['secciones'] = []
        nuevo_producto['recomendados'] = [v for v in request.form.getlist('productos_recomendados') if
                                          validar_objectid(v)]
    try:
        db.productos.insert_one(nuevo_producto)
    except Exception as e:
        current_app.logger.error(f"Error insertando producto: {e}")
        flash("Error al guardar el producto en la base de datos", "error")
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


@catalogo_bp.route('/editar-producto/<id>', methods=['POST'])
@requiere_negocio
def editar_producto(id):
    if not validar_objectid(id): abort(400)
    producto = db.productos.find_one({"_id": ObjectId(id)})
    if not producto: abort(404)
    negocio = db.negocios.find_one({"_id": producto["negocio_id"]})
    if not negocio: abort(404)
    if session.get('negocio_slug') != negocio['slug']: abort(403)
    nombre = request.form.get('nombre', '').strip()
    precio_str = request.form.get('precio', '').strip()
    if not nombre:
        flash("El nombre del producto es obligatorio", "error")
        return redirect(url_for('catalogo.index', slug_negocio=negocio['slug']))
    try:
        precio = float(precio_str)
        if precio < 0: raise ValueError("Precio negativo")
    except (ValueError, TypeError):
        flash("El precio debe ser un numero valido y positivo", "error")
        return redirect(url_for('catalogo.index', slug_negocio=negocio['slug']))
    # Descuento — buscar con múltiples variantes de nombres (edit-*, descuento-activo, etc.)
    descuento_activo, tipo_descuento, valor_descuento = extraer_descuento_form(request.form, prefix='edit')
    # Si no se encontró con prefijo, intentar sin prefijo
    if not descuento_activo:
        descuento_activo, tipo_descuento, valor_descuento = extraer_descuento_form(request.form, prefix=None)
    precio_promo = None
    if descuento_activo:
        if tipo_descuento == 'porcentaje':
            valor_descuento = min(valor_descuento, 100)
            precio_promo = round(precio * (1 - valor_descuento / 100), 2)
        else:
            valor_descuento = min(valor_descuento, precio)
            precio_promo = round(precio - valor_descuento, 2)
        if precio_promo < 0: precio_promo = 0
    update_data = {"nombre": nombre, "precio": precio,
                   "categoria": request.form.get('categoria', '').strip() or "Sin Categoria",
                   "stock": request.form.get('stock') in ('on', 'true', '1'),
                   "descuento_activo": descuento_activo,
                   "tipo_descuento": tipo_descuento if descuento_activo else 'porcentaje',
                   "valor_descuento": valor_descuento if descuento_activo else 0,
                   "precio_promo": precio_promo}
    orden_json = request.form.get('orden_imagenes')
    fotos_nuevas = request.files.getlist('fotos')
    imagenes_finales = []
    if orden_json:
        try:
            orden = json.loads(orden_json)
            for item in orden:
                if item.get('tipo') == 'existente':
                    url = item.get('url', '')
                    if url and url.startswith(
                        f"https://res.cloudinary.com/{CLOUDINARY_CLOUD_NAME}/"): imagenes_finales.append(url)
                elif item.get('tipo') == 'nueva':
                    idx = item.get('indice')
                    if isinstance(idx, int) and idx < len(fotos_nuevas):
                        url = subir_imagen_cloudinary(fotos_nuevas[idx], f"productos/{negocio['slug']}")
                        if url: imagenes_finales.append(url)
            update_data["imagenes_extra"] = imagenes_finales
            update_data["imagen_url"] = imagenes_finales[0] if imagenes_finales else ""
        except Exception as e:
            current_app.logger.error(f"Error reordenando imagenes: {e}")
    rubro = negocio.get('rubro')
    if rubro == 'ropa':
        update_data['talles'] = [t.strip() for t in request.form.get('talles_edit', '').split(',') if t.strip()]
        update_data['colores'] = [c.strip() for c in request.form.get('colores_edit', '').split(',') if c.strip()]
        update_data['material'] = request.form.get('material_edit', '').strip()
        update_data['genero'] = request.form.get('genero_edit', '').strip()
    elif rubro == 'restaurante':
        update_data['descripcion'] = request.form.get('descripcion_edit', '').strip()
        update_data['agregados_ids'] = [aid for aid in request.form.getlist('agregados_ids') if validar_objectid(aid)]
        update_data['ingredientes_ids'] = [iid for iid in request.form.getlist('ingredientes_ids') if validar_objectid(iid)]
        try:
            update_data['secciones'] = json.loads(request.form.get('secciones', '[]'))
        except:
            update_data['secciones'] = []
        update_data['recomendados'] = [v for v in request.form.getlist('productos_recomendados') if validar_objectid(v)]
    try:
        db.productos.update_one({"_id": ObjectId(id)}, {"$set": update_data})
    except Exception as e:
        current_app.logger.error(f"Error actualizando producto: {e}")
        flash("Error al actualizar el producto", "error")
    return redirect(url_for('catalogo.index', slug_negocio=negocio['slug']))


@catalogo_bp.route('/eliminar-producto/<id_prod>', methods=['POST'])
@requiere_negocio
def eliminar_producto(id_prod):
    if not validar_objectid(id_prod): abort(400)
    producto = db.productos.find_one({"_id": ObjectId(id_prod)})
    if not producto: abort(404)
    negocio = db.negocios.find_one({"_id": producto["negocio_id"]})
    if not negocio or session.get('negocio_slug') != negocio['slug']: abort(403)
    try:
        db.productos.delete_one({"_id": ObjectId(id_prod)})
    except Exception as e:
        current_app.logger.error(f"Error eliminando producto: {e}")
        flash("Error al eliminar el producto", "error")
    return redirect(url_for('catalogo.index', slug_negocio=session['negocio_slug']))


# ============================================
# GESTION DE CATEGORÍAS
# ============================================

@catalogo_bp.route('/agregar-categoria/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def agregar_categoria(slug_negocio):
    nombre_cat = request.form.get('nombre_categoria', '').strip()
    if not nombre_cat:
        flash("El nombre de la categoria es obligatorio", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    if nombre_cat.lower() in [c.lower() for c in negocio.get('categorias', [])]:
        flash("Esta categoria ya existe", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    db.negocios.update_one({"slug": slug_negocio}, {"$push": {"categorias": nombre_cat}})
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


@catalogo_bp.route('/api/editar-categoria/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def api_editar_categoria(slug_negocio):
    data = request.get_json()
    if not data:
        return jsonify({"error": "Datos inválidos"}), 400
    original = data.get('categoria_original', '').strip()
    nueva = data.get('categoria_nueva', '').strip()
    if not original or not nueva:
        return jsonify({"error": "Los nombres no pueden estar vacíos"}), 400
    if original == nueva:
        return jsonify({"ok": True})

    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio:
        return jsonify({"error": "Negocio no encontrado"}), 404

    categorias = negocio.get('categorias', [])
    # Verificar que la original existe
    if original not in categorias:
        return jsonify({"error": "La categoría no existe"}), 404
    # Verificar que la nueva no exista (case insensitive)
    if nueva.lower() in [c.lower() for c in categorias if c != original]:
        return jsonify({"error": "Ya existe una categoría con ese nombre"}), 400

    # Reemplazar en el array de categorías
    nuevas_categorias = [nueva if c == original else c for c in categorias]
    db.negocios.update_one({"slug": slug_negocio}, {"$set": {"categorias": nuevas_categorias}})

    # Actualizar todos los productos de esa categoría
    db.productos.update_many(
        {"negocio_id": negocio["_id"], "categoria": original},
        {"$set": {"categoria": nueva}}
    )

    # Actualizar secciones de catálogo si referencian la categoría
    secciones = negocio.get('secciones_catalogo', [])
    for sec in secciones:
        # Las secciones usan nombre, no categoría, pero por si acaso
        pass

    return jsonify({"ok": True})


@catalogo_bp.route('/api/eliminar-categoria/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def api_eliminar_categoria(slug_negocio):
    data = request.get_json()
    if not data:
        return jsonify({"error": "Datos inválidos"}), 400
    categoria = data.get('categoria', '').strip()
    if not categoria:
        return jsonify({"error": "Categoría inválida"}), 400

    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio:
        return jsonify({"error": "Negocio no encontrado"}), 404

    categorias = negocio.get('categorias', [])
    if categoria not in categorias:
        return jsonify({"error": "La categoría no existe"}), 404

    # Eliminar del array de categorías
    nuevas_categorias = [c for c in categorias if c != categoria]
    db.negocios.update_one({"slug": slug_negocio}, {"$set": {"categorias": nuevas_categorias}})

    # Mover productos de esa categoría a "Sin Categoria"
    db.productos.update_many(
        {"negocio_id": negocio["_id"], "categoria": categoria},
        {"$set": {"categoria": "Sin Categoria"}}
    )

    return jsonify({"ok": True})


@catalogo_bp.route('/editar-categoria/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def editar_categoria(slug_negocio):
    nombre_viejo = request.form.get('nombre_viejo', '').strip()
    nombre_nuevo = request.form.get('nombre_nuevo', '').strip()
    if not nombre_viejo or not nombre_nuevo:
        flash("Ambos nombres son obligatorios", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    categorias = negocio.get('categorias', [])
    if nombre_viejo not in categorias:
        flash("Categoria no encontrada", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    categorias[categorias.index(nombre_viejo)] = nombre_nuevo
    db.productos.update_many({"negocio_id": negocio["_id"], "categoria": nombre_viejo},
                             {"$set": {"categoria": nombre_nuevo}})
    db.negocios.update_one({"slug": slug_negocio}, {"$set": {"categorias": categorias}})
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


@catalogo_bp.route('/eliminar-categoria/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def eliminar_categoria(slug_negocio):
    nombre_cat = request.form.get('nombre', '').strip()
    if not nombre_cat:
        flash("Nombre de categoria requerido", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    db.productos.update_many({"negocio_id": negocio["_id"], "categoria": nombre_cat},
                             {"$set": {"categoria": "Sin Categoria"}})
    db.negocios.update_one({"slug": slug_negocio}, {"$pull": {"categorias": nombre_cat}})
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


# ============================================
# SECCIONES DE CATALOGO
# ============================================

@catalogo_bp.route('/agregar-seccion-catalogo/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def agregar_seccion_catalogo(slug_negocio):
    nombre_sec = request.form.get('nombre_seccion', '').strip()
    orientacion = request.form.get('orientacion', 'horizontal').strip()
    if not nombre_sec:
        flash("El nombre de la seccion es obligatorio", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    secciones = negocio.get('secciones_catalogo', [])
    if nombre_sec.lower() in [s.get('nombre', '').lower() for s in secciones]:
        flash("Esta seccion ya existe", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    if orientacion not in ('horizontal', 'vertical'):
        orientacion = 'horizontal'
    color_seccion = request.form.get('color_seccion', '#f4f6f8').strip()
    if not color_seccion.startswith('#') or len(color_seccion) not in (4, 7):
        color_seccion = '#f4f6f8'
    # Productos seleccionados para esta seccion
    productos_ids = [ObjectId(pid) for pid in request.form.getlist('productos_seccion') if validar_objectid(pid)]
    # Listas de ingredientes de la sección
    listas_raw = request.form.get('listas_ingredientes', '[]').strip()
    try:
        listas_ingredientes = json.loads(listas_raw)
        # Validar estructura: [{nombre: str, ingredientes: [str]}]
        if not isinstance(listas_ingredientes, list):
            listas_ingredientes = []
        for lista in listas_ingredientes:
            if not isinstance(lista, dict):
                listas_ingredientes.remove(lista)
                continue
            lista['nombre'] = str(lista.get('nombre', '')).strip()
            lista['ingredientes'] = [str(i).strip() for i in lista.get('ingredientes', []) if str(i).strip()]
    except:
        listas_ingredientes = []
    nueva_seccion = {"nombre": nombre_sec, "orientacion": orientacion, "orden": len(secciones), "productos": productos_ids, "color": color_seccion, "listas_ingredientes": listas_ingredientes}
    db.negocios.update_one({"slug": slug_negocio}, {"$push": {"secciones_catalogo": nueva_seccion}})
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


@catalogo_bp.route('/editar-seccion-catalogo/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def editar_seccion_catalogo(slug_negocio):
    nombre_viejo = request.form.get('nombre_viejo', '').strip()
    nombre_nuevo = request.form.get('nombre_nuevo', '').strip()
    orientacion = request.form.get('orientacion', 'horizontal').strip()
    if not nombre_viejo or not nombre_nuevo:
        flash("Ambos nombres son obligatorios", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    secciones = negocio.get('secciones_catalogo', [])
    encontrada = False
    for s in secciones:
        if s.get('nombre') == nombre_viejo:
            s['nombre'] = nombre_nuevo
            s['orientacion'] = orientacion if orientacion in ('horizontal', 'vertical') else 'horizontal'
            color_seccion = request.form.get('color_seccion', '#f4f6f8').strip()
            if not color_seccion.startswith('#') or len(color_seccion) not in (4, 7):
                color_seccion = '#f4f6f8'
            s['color'] = color_seccion
            # Actualizar productos de la seccion
            productos_ids = [ObjectId(pid) for pid in request.form.getlist('productos_seccion') if validar_objectid(pid)]
            s['productos'] = productos_ids
            # Actualizar listas de ingredientes de la sección
            listas_raw = request.form.get('listas_ingredientes', '[]').strip()
            try:
                listas_ingredientes = json.loads(listas_raw)
                if not isinstance(listas_ingredientes, list):
                    listas_ingredientes = []
                for lista in listas_ingredientes:
                    if not isinstance(lista, dict):
                        listas_ingredientes.remove(lista)
                        continue
                    lista['nombre'] = str(lista.get('nombre', '')).strip()
                    lista['ingredientes'] = [str(i).strip() for i in lista.get('ingredientes', []) if str(i).strip()]
            except:
                listas_ingredientes = []
            s['listas_ingredientes'] = listas_ingredientes
            encontrada = True
            break
    if not encontrada:
        flash("Seccion no encontrada", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    db.negocios.update_one({"slug": slug_negocio}, {"$set": {"secciones_catalogo": secciones}})
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


@catalogo_bp.route('/eliminar-seccion-catalogo/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def eliminar_seccion_catalogo(slug_negocio):
    nombre_sec = request.form.get('nombre', '').strip()
    if not nombre_sec:
        flash("Nombre de seccion requerido", "error")
        return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    db.negocios.update_one({"slug": slug_negocio},
                           {"$pull": {"secciones_catalogo": {"nombre": nombre_sec}}})
    return redirect(url_for('catalogo.index', slug_negocio=slug_negocio))


@catalogo_bp.route('/ordenar-secciones-catalogo/<slug_negocio>', methods=['POST'])
@requiere_negocio_propietario
def ordenar_secciones_catalogo(slug_negocio):
    data = request.json
    orden = data.get('orden', [])
    negocio = db.negocios.find_one({"slug": slug_negocio})
    if not negocio: abort(404)
    secciones = negocio.get('secciones_catalogo', [])
    # Reordenar segun la lista de nombres recibida
    secciones_ordenadas = []
    for nombre in orden:
        for s in secciones:
            if s.get('nombre') == nombre:
                secciones_ordenadas.append(s)
                break
    # Agregar las que no estaban en la lista de orden
    nombres_orden = set(orden)
    for s in secciones:
        if s.get('nombre') not in nombres_orden:
            secciones_ordenadas.append(s)
    # Actualizar el campo orden
    for i, s in enumerate(secciones_ordenadas):
        s['orden'] = i
    db.negocios.update_one({"slug": slug_negocio}, {"$set": {"secciones_catalogo": secciones_ordenadas}})
    return jsonify({"ok": True})
