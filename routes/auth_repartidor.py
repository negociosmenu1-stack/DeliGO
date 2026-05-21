"""
Auth Repartidor Blueprint - Landing, registro, login y logout de repartidores.
"""
import re
from datetime import datetime

from flask import (
    Blueprint, render_template, request, redirect,
    url_for, session, flash
)
from werkzeug.security import generate_password_hash, check_password_hash
from bson.objectid import ObjectId

from extensions import db
from helpers import _regenerar_sesion, validar_objectid
from rate_limit import _rate_limit

auth_repartidor_bp = Blueprint('auth_repartidor', __name__)


@auth_repartidor_bp.route('/repartidor')
def repartidor_landing():
    """Página principal del repartidor - login si ya tiene cuenta"""
    if session.get('repartidor_id'):
        return redirect(url_for('repartidor.repartidor_panel'))
    return render_template('repartidor.html', paso='login')


@auth_repartidor_bp.route('/repartidor/registro', methods=['GET', 'POST'])
@_rate_limit('registro_repartidor')
def repartidor_registro():
    """Registro de cuenta de repartidor"""
    if session.get('repartidor_id'):
        return redirect(url_for('repartidor.repartidor_panel'))

    if request.method == 'GET':
        return render_template('repartidor.html', paso='registro')

    nombre = request.form.get('nombre', '').strip()
    email = request.form.get('email', '').strip().lower()
    pwd = request.form.get('password', '')
    telefono = request.form.get('telefono', '').strip()

    if not nombre or not email or not pwd:
        flash("Todos los campos son obligatorios", "error")
        return redirect(url_for('.repartidor_registro'))

    if not re.match(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$', email):
        flash("El email no es válido", "error")
        return redirect(url_for('.repartidor_registro'))

    if len(pwd) < 6:
        flash("La contraseña debe tener al menos 6 caracteres", "error")
        return redirect(url_for('.repartidor_registro'))

    existente = db.repartidores.find_one({"email": email})
    if existente:
        flash("Ya existe una cuenta con ese email", "error")
        return redirect(url_for('.repartidor_registro'))

    try:
        result = db.repartidores.insert_one({
            "nombre": nombre,
            "email": email,
            "password": generate_password_hash(pwd),
            "telefono": telefono,
            "negocios": [],  # Array de negocios asociados
            "push_subscription": None,
            "fecha_registro": datetime.now(),
            "activo": True
        })
        session['repartidor_id'] = str(result.inserted_id)
        session['repartidor_nombre'] = nombre
        _regenerar_sesion()
        return redirect(url_for('repartidor.repartidor_panel'))
    except Exception as e:
        from flask import current_app
        current_app.logger.error(f"Error registro repartidor: {e}")
        flash("Error al registrar. Intenta de nuevo", "error")
        return redirect(url_for('.repartidor_registro'))


@auth_repartidor_bp.route('/repartidor/login', methods=['GET', 'POST'])
@_rate_limit('login_repartidor')
def repartidor_login():
    """Login de repartidor existente"""
    if session.get('repartidor_id'):
        return redirect(url_for('repartidor.repartidor_panel'))

    if request.method == 'GET':
        return render_template('repartidor.html', paso='login')

    email = request.form.get('email', '').strip().lower()
    pwd = request.form.get('password', '')

    repartidor = db.repartidores.find_one({"email": email})
    if repartidor and repartidor.get('password') and check_password_hash(repartidor['password'], pwd):
        session['repartidor_id'] = str(repartidor["_id"])
        session['repartidor_nombre'] = repartidor["nombre"]
        _regenerar_sesion()
        return redirect(url_for('repartidor.repartidor_panel'))

    flash("Email o contraseña incorrectos", "error")
    return render_template('repartidor.html', paso='login')


@auth_repartidor_bp.route('/repartidor/cerrar-sesion', methods=['POST'])
def repartidor_logout():
    """Cierra la sesión del repartidor"""
    # S3 FIX: Logout via POST y limpiar sesión completamente
    session.clear()
    session.modified = True
    return redirect(url_for('.repartidor_landing'))
