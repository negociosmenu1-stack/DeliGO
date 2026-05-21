"""
Auth Superadmin Blueprint - Login, aprobación, rechazo, renovación,
suspensión, reactivación y eliminación de negocios.
"""
import hashlib
import hmac
from datetime import datetime, timedelta

from flask import (
    Blueprint, render_template, request, redirect,
    url_for, session, flash, abort
)
from werkzeug.security import generate_password_hash, check_password_hash
from bson.objectid import ObjectId

from extensions import (
    db, SUPERADMIN_PASSWORD_HASH, SUPERADMIN_PASSWORD_PLAIN,
    LIMITE_SEMANAL_DEUDA, LIMITE_MINIMO_DEUDA,
    ALIAS_TRANSFERENCIA, NOMBRE_TRANSFERENCIA
)
from helpers import _regenerar_sesion, validar_objectid
from decorators import requiere_superadmin
from rate_limit import _rate_limit

auth_superadmin_bp = Blueprint('auth_superadmin', __name__)


def obtener_limite_deuda(negocio):
    """Devuelve el límite de deuda del negocio, o el default global si no tiene uno personalizado"""
    limite = negocio.get("limite_deuda")
    if limite and limite >= LIMITE_MINIMO_DEUDA:
        return limite
    return LIMITE_SEMANAL_DEUDA


@auth_superadmin_bp.route('/superadmin', methods=['GET', 'POST'])
@_rate_limit('login_superadmin')
def superadmin():
    if request.method == 'POST':
        pwd = request.form.get('password', '')
        es_valido = False
        # S5 FIX: Eliminar comparación en texto plano, solo usar hash
        if SUPERADMIN_PASSWORD_HASH:
            es_valido = check_password_hash(SUPERADMIN_PASSWORD_HASH, pwd)
        elif SUPERADMIN_PASSWORD_PLAIN:
            # Auto-hash la contraseña plana la primera vez y guardar en .env
            # Mientras tanto, usar comparación timing-safe (no == directa)
            es_valido = hmac.compare_digest(
                hashlib.sha256(pwd.encode('utf-8')).hexdigest(),
                hashlib.sha256(SUPERADMIN_PASSWORD_PLAIN.encode('utf-8')).hexdigest()
            )
            if es_valido:
                # Auto-generar hash para la próxima vez
                nuevo_hash = generate_password_hash(pwd)
                from flask import current_app
                current_app.logger.warning(
                    "SUPERADMIN_PASSWORD_PLAIN detectada. Hash generado automáticamente: "
                    f"SUPERADMIN_PASSWORD_HASH={nuevo_hash}  "
                    "Agregá esto a tu .env y eliminá SUPERADMIN_PASSWORD"
                )
        if es_valido:
            session['superadmin_logueado'] = True
            _regenerar_sesion()
            return redirect(url_for('.superadmin'))
        return render_template('login_admin.html', error='Contraseña incorrecta')

    if not session.get('superadmin_logueado'):
        return render_template('login_admin.html', error='')

    pendientes = list(db.negocios.find({"aprobado": False}))
    activos = list(db.negocios.find({"aprobado": True}))
    hoy = datetime.now()

    for neg in activos:
        neg['cantidad_productos'] = db.productos.count_documents({"negocio_id": neg['_id']})
        neg['deuda_tarifa'] = neg.get('deuda_tarifa', 0)
        neg['pedidos_entregados'] = db.pedidos.count_documents({"negocio_id": neg['_id'], "estado": "entregado"})
        neg['deuda_alcanzada'] = neg.get('deuda_tarifa', 0) >= obtener_limite_deuda(neg)
        neg['limite_deuda'] = obtener_limite_deuda(neg)
        vencimiento = neg.get('plan_vencimiento')
        if neg.get('suspendido', False):
            neg['estado_suscripcion'] = 'suspendido'
        elif vencimiento:
            if isinstance(vencimiento, str):
                try:
                    vencimiento = datetime.strptime(vencimiento, '%Y-%m-%d')
                except ValueError:
                    vencimiento = None
            if vencimiento:
                dias_restantes = (vencimiento - hoy).days
                if dias_restantes < 0:
                    neg['estado_suscripcion'] = 'vencido'
                elif dias_restantes <= 7:
                    neg['estado_suscripcion'] = 'por_vencer'
                else:
                    neg['estado_suscripcion'] = 'activo'
                neg['dias_restantes'] = dias_restantes
            else:
                neg['estado_suscripcion'] = 'sin_plan'
        else:
            neg['estado_suscripcion'] = 'sin_plan'

    activos_ok = [n for n in activos if n.get('estado_suscripcion') in ('activo', 'sin_plan')]
    alertas = [n for n in activos if n.get('estado_suscripcion') in ('vencido', 'por_vencer', 'suspendido')]
    count_activos = len([n for n in activos if n.get('estado_suscripcion') == 'activo'])
    count_alertas = len(alertas)

    # Calcular deuda total de todos los negocios
    deuda_total_plataforma = sum(n.get('deuda_tarifa', 0) for n in activos)
    negocios_con_deuda = [n for n in activos if n.get('deuda_tarifa', 0) > 0]

    return render_template('superadmin.html', negocios=pendientes, activos=activos,
                           activos_ok=activos_ok, alertas=alertas, count_activos=count_activos,
                           count_alertas=count_alertas,
                           limite_deuda_default=LIMITE_SEMANAL_DEUDA,
                           limite_minimo=LIMITE_MINIMO_DEUDA,
                           alias_transferencia=ALIAS_TRANSFERENCIA,
                           nombre_transferencia=NOMBRE_TRANSFERENCIA,
                           deuda_total_plataforma=deuda_total_plataforma,
                           negocios_con_deuda=negocios_con_deuda)


@auth_superadmin_bp.route('/aprobar/<id_negocio>', methods=['POST'])
@requiere_superadmin
def aprobar_negocio(id_negocio):
    if not validar_objectid(id_negocio): abort(400)
    fecha_vencimiento = (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')
    db.negocios.update_one({"_id": ObjectId(id_negocio)}, {
        "$set": {"aprobado": True, "plan_tipo": "prueba", "plan_fecha_inicio": datetime.now().strftime('%Y-%m-%d'),
                 "plan_vencimiento": fecha_vencimiento, "suspendido": False}})
    return redirect(url_for('.superadmin'))


@auth_superadmin_bp.route('/rechazar/<id_negocio>', methods=['POST'])
@requiere_superadmin
def rechazar_negocio(id_negocio):
    if not validar_objectid(id_negocio): abort(400)
    negocio = db.negocios.find_one({"_id": ObjectId(id_negocio)})
    if not negocio: abort(404)
    db.productos.delete_many({"negocio_id": negocio["_id"]})
    db.agregados.delete_many({"negocio_id": negocio["_id"]})
    db.ingredientes.delete_many({"negocio_id": negocio["_id"]})
    db.negocios.delete_one({"_id": ObjectId(id_negocio)})
    return redirect(url_for('.superadmin'))


@auth_superadmin_bp.route('/superadmin/renovar/<id_negocio>', methods=['POST'])
@requiere_superadmin
def renovar_suscripcion(id_negocio):
    if not validar_objectid(id_negocio): abort(400)
    negocio = db.negocios.find_one({"_id": ObjectId(id_negocio)})
    if not negocio: abort(404)
    periodo = request.form.get('periodo', '30')
    plan_tipo = request.form.get('plan_tipo', 'mensual')
    fecha_vencimiento_str = request.form.get('fecha_vencimiento', '')
    hoy = datetime.now()
    if fecha_vencimiento_str:
        try:
            nueva_fecha = datetime.strptime(fecha_vencimiento_str, '%Y-%m-%d')
        except ValueError:
            flash("Formato de fecha invalido", "error")
            return redirect(url_for('.superadmin'))
    else:
        vencimiento_actual = negocio.get('plan_vencimiento')
        fecha_base = hoy
        if vencimiento_actual:
            if isinstance(vencimiento_actual, str):
                try:
                    fecha_venc = datetime.strptime(vencimiento_actual, '%Y-%m-%d')
                    if fecha_venc > hoy: fecha_base = fecha_venc
                except ValueError:
                    pass
            elif isinstance(vencimiento_actual, datetime) and vencimiento_actual > hoy:
                fecha_base = vencimiento_actual
        try:
            dias = int(periodo)
        except ValueError:
            dias = 30
        nueva_fecha = fecha_base + timedelta(days=dias)
    db.negocios.update_one({"_id": ObjectId(id_negocio)}, {
        "$set": {"plan_tipo": plan_tipo, "plan_vencimiento": nueva_fecha.strftime('%Y-%m-%d'),
                 "plan_fecha_renovacion": hoy.strftime('%Y-%m-%d'), "suspendido": False}})
    return redirect(url_for('.superadmin'))


@auth_superadmin_bp.route('/superadmin/suspender/<id_negocio>', methods=['POST'])
@requiere_superadmin
def suspender_negocio(id_negocio):
    if not validar_objectid(id_negocio): abort(400)
    db.negocios.update_one({"_id": ObjectId(id_negocio)}, {"$set": {"suspendido": True}})
    return redirect(url_for('.superadmin'))


@auth_superadmin_bp.route('/superadmin/reactivar/<id_negocio>', methods=['POST'])
@requiere_superadmin
def reactivar_negocio(id_negocio):
    if not validar_objectid(id_negocio): abort(400)
    db.negocios.update_one({"_id": ObjectId(id_negocio)}, {"$set": {"suspendido": False}})
    return redirect(url_for('.superadmin'))


@auth_superadmin_bp.route('/superadmin/eliminar-activo/<id_negocio>', methods=['POST'])
@requiere_superadmin
def eliminar_negocio_activo(id_negocio):
    if not validar_objectid(id_negocio): abort(400)
    negocio = db.negocios.find_one({"_id": ObjectId(id_negocio)})
    if not negocio: abort(404)
    db.productos.delete_many({"negocio_id": negocio["_id"]})
    db.agregados.delete_many({"negocio_id": negocio["_id"]})
    db.ingredientes.delete_many({"negocio_id": negocio["_id"]})
    db.negocios.delete_one({"_id": ObjectId(id_negocio)})
    return redirect(url_for('.superadmin'))
