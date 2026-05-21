"""
Auth Cliente Blueprint - Registro, login, Google OAuth y logout de clientes.
"""
import re
import hashlib
import hmac
from datetime import datetime

from flask import (
    Blueprint, render_template, request, redirect,
    url_for, session, flash
)
from werkzeug.security import generate_password_hash, check_password_hash
from bson.objectid import ObjectId

from extensions import db, oauth, google, SUPERADMIN_PASSWORD_HASH, SUPERADMIN_PASSWORD_PLAIN
from helpers import _regenerar_sesion, validar_objectid
from rate_limit import _rate_limit

auth_cliente_bp = Blueprint('auth_cliente', __name__)


@auth_cliente_bp.route('/cliente/registro', methods=['GET', 'POST'])
@_rate_limit('registro_cliente')
def registro_cliente():
    if request.method == 'POST':
        nombre = request.form.get('nombre', '').strip()
        email = request.form.get('email', '').strip().lower()
        pwd = request.form.get('password', '')
        telefono = request.form.get('telefono', '').strip()

        if not nombre or not email or not pwd:
            flash("Todos los campos son obligatorios", "error")
            return redirect(url_for('.registro_cliente'))

        if not re.match(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$', email):
            flash("El email no es válido", "error")
            return redirect(url_for('.registro_cliente'))

        if len(pwd) < 6:
            flash("La contraseña debe tener al menos 6 caracteres", "error")
            return redirect(url_for('.registro_cliente'))

        existente = db.clientes.find_one({"email": email})
        if existente:
            flash("Ya existe una cuenta con ese email", "error")
            return redirect(url_for('.registro_cliente'))

        try:
            db.clientes.insert_one({
                "nombre": nombre, "email": email,
                "password": generate_password_hash(pwd),
                "telefono": telefono, "google_id": None,
                "push_subscription": None,
                "direcciones": [], "fecha_registro": datetime.now()
            })
            cliente = db.clientes.find_one({"email": email})
            session['cliente_id'] = str(cliente["_id"])
            session['cliente_nombre'] = cliente["nombre"]
            _regenerar_sesion()
            flash("¡Registro exitoso! Bienvenido a NortFood", "success")
            return redirect(url_for('cliente_home.home'))
        except Exception as e:
            from flask import current_app
            current_app.logger.error(f"Error registro cliente: {e}")
            flash("Error al registrar. Intenta de nuevo", "error")

    return render_template('cliente_registro.html')


@auth_cliente_bp.route('/cliente/login', methods=['GET', 'POST'])
@_rate_limit('login_cliente')
def login_cliente():
    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        pwd = request.form.get('password', '')

        cliente = db.clientes.find_one({"email": email})

        if cliente and cliente.get('password') and check_password_hash(cliente['password'], pwd):
            session['cliente_id'] = str(cliente["_id"])
            session['cliente_nombre'] = cliente["nombre"]
            _regenerar_sesion()
            flash("¡Bienvenido de vuelta!", "success")
            return redirect(url_for('cliente_home.home'))

        flash("Email o contraseña incorrectos", "error")

    return render_template('cliente_login.html')


@auth_cliente_bp.route('/cliente/login/google')
def login_google():
    redirect_uri = url_for('.auth_google_callback', _external=True)
    return google.authorize_redirect(redirect_uri)


@auth_cliente_bp.route('/auth/google/callback')
def auth_google_callback():
    try:
        token = google.authorize_access_token()
        userinfo = token.get('userinfo')

        if not userinfo:
            resp = google.get('userinfo')
            userinfo = resp.json()

        email = userinfo.get('email', '').lower()
        nombre = userinfo.get('name', '')
        google_id = userinfo.get('sub')

        if not email:
            flash("No se pudo obtener el email de Google", "error")
            return redirect(url_for('.login_cliente'))

        cliente = db.clientes.find_one({"$or": [{"google_id": google_id}, {"email": email}]})

        if cliente:
            if not cliente.get('google_id'):
                db.clientes.update_one({"_id": cliente["_id"]}, {"$set": {"google_id": google_id}})
            session['cliente_id'] = str(cliente["_id"])
            session['cliente_nombre'] = cliente.get("nombre", nombre)
            _regenerar_sesion()
        else:
            nuevo_cliente = {
                "nombre": nombre, "email": email, "password": None,
                "google_id": google_id, "telefono": "",
                "push_subscription": None,
                "direcciones": [], "fecha_registro": datetime.now()
            }
            result = db.clientes.insert_one(nuevo_cliente)
            session['cliente_id'] = str(result.inserted_id)
            session['cliente_nombre'] = nombre
            _regenerar_sesion()

        flash("¡Inicio de sesión con Google exitoso!", "success")
        return redirect(url_for('cliente_home.home'))

    except Exception as e:
        from flask import current_app
        current_app.logger.error(f"Error callback Google: {e}")
        flash("Error al iniciar sesión con Google", "error")
        return redirect(url_for('.login_cliente'))


@auth_cliente_bp.route('/cliente/logout', methods=['POST'])
def logout_cliente():
    # S3 FIX: Logout via POST (no GET) para evitar CSRF logout attacks
    # y regenerar sesión para prevenir session fixation
    session.pop('cliente_id', None)
    session.pop('cliente_nombre', None)
    session.clear()  # Limpiar toda la sesión
    session.modified = True  # Forzar nueva cookie de sesión
    flash("Has cerrado sesión", "info")
    return redirect(url_for('cliente_home.home'))
