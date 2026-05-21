"""
NortFood - Extensions & Configuration
======================================
Archivo compartido con la conexión a MongoDB, Cloudinary, OAuth, VAPID,
constantes de monetización y todo lo que los blueprints necesitan importar.
"""
import os
import re
from datetime import timedelta

from pymongo import MongoClient
from dotenv import load_dotenv
from authlib.integrations.flask_client import OAuth
import cloudinary
import cloudinary.uploader

load_dotenv()

# ============================================
# CONEXIÓN MONGODB
# ============================================
MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    raise RuntimeError("MONGO_URI no configurada. Definila en tu archivo .env")

client = MongoClient(MONGO_URI)
db = client['plataforma_pedidos']

# ============================================
# CREAR ÍNDICES (Mejora de Rendimiento y Seguridad)
# ============================================
for idx_name in ["slug_1", "usuario_1"]:
    try:
        db.negocios.drop_index(idx_name)
    except Exception:
        pass

db.negocios.create_index("slug", unique=True, name="slug_unique_partial",
                         partialFilterExpression={"slug": {"$type": "string"}})
db.negocios.create_index("usuario", unique=True, name="usuario_unique_partial",
                         partialFilterExpression={"usuario": {"$type": "string"}})
db.productos.create_index("negocio_id")
db.agregados.create_index("negocio_id")
db.ingredientes.create_index("negocio_id")

# Índices para la colección de Clientes
db.clientes.create_index("email", unique=True, partialFilterExpression={"email": {"$type": "string"}})
db.clientes.create_index("google_id", partialFilterExpression={"google_id": {"$type": "string"}})

# Índice para repartidores
db.repartidores.create_index("negocio_id")
db.repartidores.create_index("codigo_acceso", unique=True, name="codigo_acceso_unique",
                             partialFilterExpression={"codigo_acceso": {"$type": "string"}})

db.clientes.create_index("push_subscription", sparse=True, name="push_subscription_sparse")

# ============================================
# CONFIGURACIÓN CLOUDINARY
# ============================================
CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME")
CLOUDINARY_API_KEY = os.getenv("CLOUDINARY_API_KEY")
CLOUDINARY_API_SECRET = os.getenv("CLOUDINARY_API_SECRET")

if not all([CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET]):
    raise RuntimeError("Variables de Cloudinary no configuradas. Verifica tu .env")

cloudinary.config(
    cloud_name=CLOUDINARY_CLOUD_NAME,
    api_key=CLOUDINARY_API_KEY,
    api_secret=CLOUDINARY_API_SECRET,
    secure=True
)

# ============================================
# CONFIGURACIÓN OAUTH (GOOGLE)
# ============================================
# Se inicializa después de crear la app en app.py con init_oauth(app)
oauth = None
google = None


def init_oauth(app):
    """Inicializa OAuth con la app Flask (debe llamarse desde app.py)"""
    global oauth, google
    oauth = OAuth(app)
    google = oauth.register(
        name='google',
        client_id=os.getenv("GOOGLE_CLIENT_ID"),
        client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
        access_token_url='https://oauth2.googleapis.com/token',
        authorize_url='https://accounts.google.com/o/oauth2/v2/auth',
        api_base_url='https://www.googleapis.com/oauth2/v1/',
        userinfo_endpoint='https://openidconnect.googleapis.com/v1/userinfo',
        client_kwargs={'scope': 'openid email profile'},
    )


# ============================================
# SUPERADMIN CONFIG
# ============================================
SUPERADMIN_PASSWORD_HASH = os.getenv("SUPERADMIN_PASSWORD_HASH")
SUPERADMIN_PASSWORD_PLAIN = os.getenv("SUPERADMIN_PASSWORD")
if not SUPERADMIN_PASSWORD_HASH and not SUPERADMIN_PASSWORD_PLAIN:
    raise RuntimeError("SUPERADMIN_PASSWORD o SUPERADMIN_PASSWORD_HASH no configurada. Verifica tu .env")

# ============================================
# SISTEMA DE MONETIZACIÓN - Constantes
# ============================================
TARIFA_SERVICIO = 250          # $250 por pedido
LIMITE_SEMANAL_DEUDA = 10000   # $10.000 límite semanal (default, se puede personalizar por negocio)
ALIAS_TRANSFERENCIA = "NortFood.bru"
NOMBRE_TRANSFERENCIA = "Leonardo Campos"
PORCENTAJE_ALERTA_DEUDA = 80   # Alertar al alcanzar 80% del límite
LIMITE_MINIMO_DEUDA = 5000     # Mínimo configurable por negocio ($5.000)

# ============================================
# EXTENSIONES DE ARCHIVO PERMITIDAS
# ============================================
EXTENSIONES_PERMITIDAS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
EXTENSIONES_DOCUMENTOS = {'pdf'}
EXTENSIONES_CHAT = EXTENSIONES_PERMITIDAS | EXTENSIONES_DOCUMENTOS

# ============================================
# PATRONES REGEX
# ============================================
PATRON_HORA = re.compile(r'^\d{2}:\d{2}$')

PATRON_TELEFONO = re.compile(
    r'(?:(?:whatsapp|wa|wsp|llam[aá]me|llamame|tel[eé]fono|telefono|celular|n[uú]mero|numero|contacto)[\s:.-]*)*'
    r'(?:\+?549?|0?11|0?15)[\s.-]*\d{2,4}[\s.-]*\d{4}[\s.-]*\d{0,4}'
    r'|(?:15[\s.-]?\d{4}[\s.-]?\d{4})'
    r'|(?:11[\s.-]?\d{4}[\s.-]?\d{4})'
    r'|(?:wa\.me/\d+)'
    r'|(?:whatsapp\.com/send\?phone=\d+)'
    r'|(?:3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})',
    re.IGNORECASE
)

# ============================================
# CONFIGURACIÓN VAPID (Push Notifications)
# ============================================
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY")
_vapid_private_raw = os.getenv("VAPID_PRIVATE_KEY", "")
# Las claves PEM en .env tienen \\n como literales; las convertimos a saltos de línea reales
if _vapid_private_raw and "\\n" in _vapid_private_raw and "\n" not in _vapid_private_raw:
    VAPID_PRIVATE_KEY = _vapid_private_raw.replace("\\n", "\n")
else:
    VAPID_PRIVATE_KEY = _vapid_private_raw
VAPID_CLAIMS = {"sub": "mailto:nortfood@gmail.com"}

# ============================================
# CREAR ÍNDICES - función para llamar desde app.py si hace falta
# ============================================
def ensure_indexes():
    """Crea índices en MongoDB si no existen (idempotente)"""
    # Ya se crearon arriba al importar, pero esta función permite
    # llamarla explícitamente si se necesita reiniciar
    pass
