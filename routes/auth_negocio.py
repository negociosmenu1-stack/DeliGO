"""
Auth Negocio Blueprint - Registro, login y logout de negocios.
"""
import re
from datetime import datetime

from flask import (
    Blueprint, render_template, request, redirect,
    url_for, session, flash
)
from werkzeug.security import generate_password_hash, check_password_hash

from extensions import db
from helpers import _regenerar_sesion
from rate_limit import _rate_limit

auth_negocio_bp = Blueprint('auth_negocio', __name__)


@auth_negocio_bp.route('/registro')
def registro():
    return render_template('registro.html', error=request.args.get('error', ''))


@auth_negocio_bp.route('/procesar-registro', methods=['POST'])
@_rate_limit('registro_negocio')
def procesar_registro():
    nombre = request.form.get('nombre_local', '').strip()
    user = request.form.get('usuario', '').strip()
    pwd = request.form.get('password', '')
    rubro = request.form.get('rubro', '').strip()

    if not nombre or not user or not pwd or not rubro:
        flash('Todos los campos son obligatorios', 'error')
        return redirect(url_for('.registro'))

    if len(pwd) < 6:
        flash('La contraseña debe tener al menos 6 caracteres', 'error')
        return redirect(url_for('.registro'))

    if not re.match(r'^[a-zA-Z0-9_]{3,30}$', user):
        flash('El usuario solo puede contener letras, numeros y guiones bajos', 'error')
        return redirect(url_for('.registro'))

    slug = re.sub(r'[^a-z0-9]+', '-', nombre.lower()).strip('-')

    if not slug:
        flash('El nombre del local genera un slug invalido', 'error')
        return redirect(url_for('.registro'))

    existente = db.negocios.find_one({"$or": [{"usuario": user}, {"slug": slug}]})
    if existente:
        if existente.get('usuario') == user:
            flash('Ese nombre de usuario ya esta registrado', 'error')
        else:
            flash('Ya existe un local con un nombre similar', 'error')
        return redirect(url_for('.registro'))

    rubros_validos = ['ropa', 'restaurante', 'otro']
    if rubro not in rubros_validos:
        flash('Rubro invalido', 'error')
        return redirect(url_for('.registro'))

    try:
        db.negocios.insert_one({
            "slug": slug, "nombre": nombre, "usuario": user,
            "password": generate_password_hash(pwd), "rubro": rubro,
            "aprobado": False, "color_principal": "#38b087",
            "mensaje_bienvenida": f"Bienvenidos a {nombre}!", "categorias": ["Destacados"],
            "horarios": {}, "whatsapp": "", "instagram": "", "facebook": "",
            "suspendido": False, "plan_tipo": "", "plan_vencimiento": "",
            "plan_fecha_inicio": "", "plan_fecha_renovacion": ""
        })
    except Exception as e:
        from flask import current_app
        current_app.logger.error(f"Error en registro: {e}")
        flash('Error al registrar. Intenta de nuevo', 'error')
        return redirect(url_for('.registro'))

    session['registro_slug'] = slug
    return redirect(url_for('.en_revision'))


@auth_negocio_bp.route('/login', methods=['GET', 'POST'])
@_rate_limit('login_negocio')
def login():
    if request.method == 'POST':
        user = request.form.get('usuario', '').strip()
        pwd = request.form.get('password', '')

        if not user or not pwd:
            return render_template('login.html', error='Usuario y contraseña son obligatorios')

        negocio = db.negocios.find_one({"usuario": user})

        if negocio and check_password_hash(negocio.get('password', ''), pwd):
            if not negocio.get("aprobado", False):
                session['registro_slug'] = negocio['slug']
                return redirect(url_for('.en_revision'))

            session['negocio_slug'] = negocio['slug']
            session.permanent = True
            _regenerar_sesion()
            return redirect(url_for('catalogo.index', slug_negocio=negocio['slug']))

        return render_template('login.html', error='Credenciales incorrectas')

    return render_template('login.html', error='', info='')


@auth_negocio_bp.route('/logout', methods=['POST'])
def logout():
    # S3 FIX: Logout via POST y limpiar sesión completamente
    session.clear()
    session.modified = True
    return redirect(url_for('.login'))


@auth_negocio_bp.route('/en-revision')
def en_revision():
    slug = session.get('registro_slug', '')
    return render_template('en_revision.html', slug=slug)
