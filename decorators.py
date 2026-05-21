"""
Decorators for authentication and authorization.
"""
from functools import wraps

from flask import session, redirect, url_for, abort


def requiere_negocio(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'negocio_slug' not in session:
            return redirect(url_for('auth_negocio.login'))
        return f(*args, **kwargs)
    return decorated_function


def requiere_negocio_propietario(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        slug_negocio = kwargs.get('slug_negocio')
        if 'negocio_slug' not in session:
            return redirect(url_for('auth_negocio.login'))
        if session['negocio_slug'] != slug_negocio:
            abort(403)
        return f(*args, **kwargs)
    return decorated_function


def requiere_superadmin(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('superadmin_logueado'):
            return redirect(url_for('auth_superadmin.superadmin'))
        return f(*args, **kwargs)
    return decorated_function
