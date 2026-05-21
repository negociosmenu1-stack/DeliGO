"""
NortFood - Blueprints Registration
====================================
Todos los blueprints se importan y registran aquí.
La función register_blueprints(app) se llama desde app.py.
"""

from routes.auth_cliente import auth_cliente_bp
from routes.auth_negocio import auth_negocio_bp
from routes.auth_repartidor import auth_repartidor_bp
from routes.auth_superadmin import auth_superadmin_bp
from routes.catalogo import catalogo_bp
from routes.cliente_home import cliente_home_bp
from routes.carrito import carrito_bp
from routes.chat import chat_bp
from routes.pedidos import pedidos_bp
from routes.resenas import resenas_bp
from routes.promociones import promociones_bp
from routes.configuracion import configuracion_bp
from routes.repartidor import repartidor_bp
from routes.push_notifications import push_notifications_bp
from routes.monetizacion import monetizacion_bp


def register_blueprints(app):
    """Registra todos los blueprints en la app Flask"""
    app.register_blueprint(auth_cliente_bp)
    app.register_blueprint(auth_negocio_bp)
    app.register_blueprint(auth_repartidor_bp)
    app.register_blueprint(auth_superadmin_bp)
    app.register_blueprint(catalogo_bp)
    app.register_blueprint(cliente_home_bp)
    app.register_blueprint(carrito_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(pedidos_bp)
    app.register_blueprint(resenas_bp)
    app.register_blueprint(promociones_bp)
    app.register_blueprint(configuracion_bp)
    app.register_blueprint(repartidor_bp)
    app.register_blueprint(push_notifications_bp)
    app.register_blueprint(monetizacion_bp)
