/* =========================================
   NORTFOOD - LÓGICA DEL CARRITO (CHECKOUT)
   ========================================= */

let carrito = [];
let total = 0;
let totalCantidad = 0;
let metodoEntrega = 'retiro';
let metodoPago = 'efectivo';
let direccionSeleccionada = null;
let precioDelivery = 0; // Precio de delivery según zona del cliente

// Tarifa de servicio (inyectada desde el template)
const TARIFA_SERVICIO = window.TARIFA_SERVICIO || 250;

// Clave única por negocio
const STORAGE_KEY = 'nortfood_carrito_' + (window.NEGOCIO_SLUG || '');

document.addEventListener('DOMContentLoaded', () => {
    cargarCarrito();
    renderizarCarrito();
    validarFormulario();
    cargarUbicacionDelHome();
    ajustarPaddingScroll();
    window.addEventListener('resize', ajustarPaddingScroll);
});

// Ajusta padding-top y padding-bottom del body según el tamaño real del header y footer
// para que el scroll sea exacto: sube hasta la cuenta, baja hasta el método de pago
function ajustarPaddingScroll() {
    const header = document.querySelector('.carrito-header');
    const footer = document.querySelector('.carrito-footer');

    if (header) {
        document.body.style.paddingTop = header.offsetHeight + 'px';
    }
    if (footer) {
        document.body.style.paddingBottom = footer.offsetHeight + 'px';
    }
}

function cargarCarrito() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
            const parsed = JSON.parse(data);
            carrito = parsed.carrito || [];
        }
    } catch (e) { console.error(e); }
}

function renderizarCarrito() {
    const container = document.getElementById('lista-items');
    if (!container) return;

    if (carrito.length === 0) {
        container.innerHTML = `
            <div class="carrito-empty-state" style="text-align:center; padding:20px; color:#999;">
                <div style="font-size:40px; margin-bottom:10px;">🛒</div>
                <p>Tu carrito está vacío</p>
                <a href="/${window.NEGOCIO_SLUG}" style="color:#FB8C00; font-weight:bold; text-decoration:none;">Ir al catálogo</a>
            </div>`;
        total = 0; totalCantidad = 0;
    } else {
        let html = '';
        total = 0; totalCantidad = carrito.length;

        carrito.forEach((item, index) => {
            let precioFinal = item.precio || 0;
            let detalles = [];

            if (item.seccionesPrecios) {
                for (const key in item.seccionesPrecios) precioFinal += item.seccionesPrecios[key];
            }
            if (item.agregados && item.agregados.length > 0) {
                item.agregados.forEach(a => precioFinal += (a.precio || 0));
                detalles.push(`+ ${item.agregados.map(a => a.nombre).join(', ')}`);
            }
            if (item.secciones) {
                 for (const sec in item.secciones) detalles.push(`${sec}: ${Array.isArray(item.secciones[sec]) ? item.secciones[sec].join(', ') : item.secciones[sec]}`);
            }
            if (item.ingredientesQuitados && item.ingredientesQuitados.length > 0) {
                detalles.push(`Sin: ${item.ingredientesQuitados.join(', ')}`);
            }
            if (item.listasSeccionQuitados) {
                for (const listaNombre in item.listasSeccionQuitados) {
                    const quitados = item.listasSeccionQuitados[listaNombre];
                    if (quitados && quitados.length > 0) {
                        detalles.push(`${listaNombre} sin: ${quitados.join(', ')}`);
                    }
                }
            }
            if (item.talle) detalles.push(`Talle: ${item.talle}`);
            if (item.color) detalles.push(`Color: ${item.color}`);

            total += precioFinal;
            html += `
            <div class="carrito-item">
                <div class="carrito-item-top">
                    <span class="carrito-item-nombre">${item.nombre}</span>
                    <span class="carrito-item-precio">$${precioFinal.toFixed(2)}</span>
                </div>
                ${detalles.length > 0 ? `<div class="carrito-item-detalle">${detalles.join(' | ')}</div>` : ''}
                <button class="carrito-item-remove" onclick="eliminarItem(${index})">Eliminar</button>
            </div>`;
        });
        container.innerHTML = html;
    }

    // Actualizar desglose de precios en el footer
    const subtotalEl = document.getElementById('display-subtotal');
    const tarifaEl = document.getElementById('display-tarifa');
    const totalEl = document.getElementById('display-total');

    if (subtotalEl) subtotalEl.textContent = `$${total.toFixed(2)}`;
    if (tarifaEl) tarifaEl.textContent = `$${TARIFA_SERVICIO}`;
    const deliveryTotal = metodoEntrega === 'domicilio' ? precioDelivery : 0;
    const extraCosts = (carrito.length > 0 ? TARIFA_SERVICIO : 0) + (deliveryTotal > 0 ? deliveryTotal : 0);
    if (totalEl) totalEl.textContent = `$${(total + extraCosts).toFixed(2)}`;

    window.scrollTo(0, window.scrollY);
}

function eliminarItem(index) {
    if(!confirm('¿Eliminar este producto?')) return;
    carrito.splice(index, 1);
    guardarCarrito();
    renderizarCarrito();
    validarFormulario();
}

function guardarCarrito() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ carrito, total, totalCantidad })); } catch(e) {}
}

// ============================================
// UBICACIÓN: Usar la del Home (localStorage)
// ============================================

// Cargar la ubicación que el usuario seleccionó en el Home
function cargarUbicacionDelHome() {
    try {
        const dirGuardada = localStorage.getItem('nortfood_direccion_seleccionada');
        if (dirGuardada) {
            const dir = JSON.parse(dirGuardada);
            direccionSeleccionada = {
                alias: dir.alias || 'Mi ubicación',
                direccion: dir.direccion || dir.alias || 'Ubicación actual',
                referencia: dir.referencia || '',
                lat: dir.lat ? parseFloat(dir.lat) : null,
                lng: dir.lng ? parseFloat(dir.lng) : null
            };
        }
    } catch(e) {
        console.warn('Error cargando ubicación del home:', e);
    }

    // Renderizar el panel de dirección con la ubicación actual
    renderizarPanelDireccion();
}

// Renderizar el panel de dirección mostrando la ubicación del Home
function renderizarPanelDireccion() {
    const panel = document.getElementById('panel-direcciones');
    if (!panel) return;

    if (direccionSeleccionada && direccionSeleccionada.lat && direccionSeleccionada.lng) {
        // Hay ubicación del Home, mostrarla
        const alias = direccionSeleccionada.alias || 'Mi ubicación';
        const direccion = direccionSeleccionada.direccion || '';
        const referencia = direccionSeleccionada.referencia || '';

        panel.innerHTML = `
            <div class="carrito-dir-option seleccionada" style="cursor:default;">
                <div class="carrito-dir-icon">📍</div>
                <div class="carrito-dir-info">
                    <span class="carrito-dir-alias">${alias}</span>
                    <span class="carrito-dir-full">${direccion}</span>
                    ${referencia ? `<span class="carrito-dir-ref">${referencia}</span>` : ''}
                </div>
                <div class="carrito-dir-check" style="color:#4CAF50;">✓</div>
            </div>
        `;

    } else if (direccionSeleccionada) {
        // Tiene dirección pero sin coordenadas
        const alias = direccionSeleccionada.alias || 'Mi ubicación';
        const direccion = direccionSeleccionada.direccion || '';

        panel.innerHTML = `
            <div class="carrito-dir-option" style="cursor:default;border-color:#ffcc80;">
                <div class="carrito-dir-icon">📍</div>
                <div class="carrito-dir-info">
                    <span class="carrito-dir-alias">${alias}</span>
                    <span class="carrito-dir-full">${direccion}</span>
                    <span class="carrito-dir-ref" style="color:#e65100;font-size:11px;">Sin coordenadas - no se puede calcular el precio de envío</span>
                </div>
            </div>
        `;

    } else {
        // No hay ninguna ubicación
        panel.innerHTML = `
            <div style="text-align:center;padding:16px;background:#fff3e0;border-radius:12px;border:1px solid #ffcc80;">
                <div style="font-size:28px;margin-bottom:6px;">📍</div>
                <p style="margin:0 0 8px;font-size:13px;color:#e65100;font-weight:600;">No tenés ubicación seleccionada</p>
                <p style="margin:0 0 10px;font-size:12px;color:#999;">Necesitás seleccionar tu ubicación para calcular el envío</p>
                <a href="/" style="display:inline-block;padding:8px 16px;background:#FB8C00;color:white;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;font-family:'Nunito',sans-serif;">Seleccionar ubicación</a>
            </div>`;
    }
}

// --- SELECCIÓN DE ENTREGA ---
function seleccionarEntrega(tipo) {
    metodoEntrega = tipo;
    document.querySelectorAll('input[name="entrega"]').forEach(r => r.checked = (r.value === tipo));
    const panel = document.getElementById('panel-direcciones');
    if (tipo === 'domicilio') {
        panel.style.display = 'block';
        actualizarPrecioDelivery();
    }
    else { panel.style.display = 'none'; }
    actualizarPrecioDelivery();
    validarFormulario();
    // Reajustar padding porque al mostrar/ocultar direcciones cambia el contenido
    setTimeout(ajustarPaddingScroll, 50);
}

// --- ZONA DE DELIVERY: calcular precio según ubicación ---
// Algoritmo ray-casting: verifica si un punto está dentro de un polígono
// poligono = [[lat, lng], [lat, lng], ...]
function puntoEnPoligono(lat, lng, poligono) {
    if (!poligono || poligono.length < 3) return false;
    let dentro = false;
    const n = poligono.length;
    let j = n - 1;
    for (let i = 0; i < n; i++) {
        const lat_i = poligono[i][0], lng_i = poligono[i][1];
        const lat_j = poligono[j][0], lng_j = poligono[j][1];
        if ((lat_i > lat) !== (lat_j > lat) &&
            (lng < (lng_j - lng_i) * (lat - lat_i) / (lat_j - lat_i) + lng_i)) {
            dentro = !dentro;
        }
        j = i;
    }
    return dentro;
}

// Calcular el precio de delivery basado en la zona de la dirección del cliente
function calcularPrecioDelivery(lat, lng) {
    const zonas = window.ZONAS_DELIVERY || [];
    const zonaActiva = window.ZONA_DELIVERY_ACTIVA;

    if (!zonaActiva || !lat || !lng) return 0;

    // Buscar la zona que contiene al cliente
    for (let zona of zonas) {
        const puntos = zona.puntos || [];
        if (puntos.length >= 3 && puntoEnPoligono(lat, lng, puntos)) {
            return zona.precio || 0;
        }
    }

    // Si no está en ninguna zona y la zona está activa, no se puede hacer delivery
    // Retornamos -1 para indicar fuera de zona
    return -1;
}

// Actualizar el precio de delivery cuando se selecciona una dirección
function actualizarPrecioDelivery() {
    const deliveryRow = document.getElementById('display-delivery-row');
    const deliveryPrecio = document.getElementById('display-delivery');

    if (metodoEntrega !== 'domicilio') {
        precioDelivery = 0;
        if (deliveryRow) deliveryRow.style.display = 'none';
        renderizarCarrito();
        return;
    }

    if (direccionSeleccionada && direccionSeleccionada.lat && direccionSeleccionada.lng) {
        const precio = calcularPrecioDelivery(direccionSeleccionada.lat, direccionSeleccionada.lng);
        if (precio === -1) {
            // Fuera de zona
            precioDelivery = 0;
            if (deliveryPrecio) deliveryPrecio.textContent = 'Fuera de zona';
            if (deliveryRow) deliveryRow.style.display = 'flex';
        } else {
            precioDelivery = precio;
            if (deliveryPrecio) deliveryPrecio.textContent = precio === 0 ? 'Gratis' : '$' + precio;
            if (deliveryRow) deliveryRow.style.display = 'flex';
        }
    } else {
        // Sin coordenadas, no se puede calcular
        precioDelivery = 0;
        if (deliveryPrecio) deliveryPrecio.textContent = 'N/A';
        if (deliveryRow) deliveryRow.style.display = 'flex';
    }

    renderizarCarrito();
}

// --- PAGO ---
function seleccionarPago(tipo, el) {
    metodoPago = tipo;
    document.getElementById('input-metodo-pago').value = tipo;
    document.querySelectorAll('.carrito-pago-card').forEach(c => c.classList.remove('seleccionado'));
    el.classList.add('seleccionado');
    validarFormulario();
}

// --- VALIDACIÓN ---
function validarFormulario() {
    const btn = document.getElementById('btn-hacer-pedido');
    let valido = true;
    if (metodoEntrega === 'domicilio' && !direccionSeleccionada) valido = false;
    if (metodoEntrega === 'domicilio' && direccionSeleccionada && !direccionSeleccionada.lat) valido = false;
    if (total <= 0) valido = false;

    if (valido) { btn.classList.remove('disabled'); btn.disabled = false; }
    else { btn.classList.add('disabled'); btn.disabled = true; }
}

// --- ENVIAR ---
async function enviarPedido() {
    if (document.getElementById('btn-hacer-pedido').disabled) return;

    // El total que se envía es SOLO el de los productos (sin tarifa)
    // El servidor agregará la tarifa de servicio automáticamente
    const pedidoData = {
        slug: window.NEGOCIO_SLUG,
        cliente_nombre: window.CLIENTE_NOMBRE || 'Cliente Anónimo',
        cliente_telefono: window.CLIENTE_TELEFONO || '',
        items: carrito.map(i => {
            let precioTotal = i.precio || 0;
            if (i.seccionesPrecios) { for (const k in i.seccionesPrecios) precioTotal += i.seccionesPrecios[k]; }
            if (i.agregados) i.agregados.forEach(a => precioTotal += (a.precio || 0));
            return {
                productoId: i.productoId || '',
                nombre: i.nombre,
                precio: precioTotal,
                cantidad: 1,
                agregados: i.agregados || [],
                secciones: i.secciones || {},
                seccionesPrecios: i.seccionesPrecios || {},
                ingredientes: i.ingredientes || [],
                ingredientesQuitados: i.ingredientesQuitados || [],
                listasSeccion: i.listasSeccion || [],
                listasSeccionQuitados: i.listasSeccionQuitados || {},
                talle: i.talle || '',
                color: i.color || ''
            };
        }),
        total: total,  // Total de productos (sin tarifa). El servidor suma la tarifa.
        metodo_entrega: metodoEntrega,
        direccion: metodoEntrega === 'domicilio' && direccionSeleccionada ? direccionSeleccionada.direccion : '',
        referencia: metodoEntrega === 'domicilio' && direccionSeleccionada ? direccionSeleccionada.referencia : '',
        lat: metodoEntrega === 'domicilio' && direccionSeleccionada && direccionSeleccionada.lat ? direccionSeleccionada.lat : null,
        lng: metodoEntrega === 'domicilio' && direccionSeleccionada && direccionSeleccionada.lng ? direccionSeleccionada.lng : null,
        precio_delivery: metodoEntrega === 'domicilio' ? precioDelivery : 0,
        metodo_pago: metodoPago
    };

    const btn = document.getElementById('btn-hacer-pedido');
    const txt = btn.textContent;
    btn.textContent = "Enviando..."; btn.disabled = true;

    try {
        const res = await fetch('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pedidoData) });
        const data = await res.json();

        if (res.ok) {
            carrito = []; total = 0; totalCantidad = 0;
            localStorage.removeItem(STORAGE_KEY);

            // Mostrar animación de éxito con confetti y sonido
            NortUI.orderSuccess({
                negocio: window.NEGOCIO_NOMBRE || window.NEGOCIO_SLUG,
                items: pedidoData.items.length,
                total: pedidoData.total + TARIFA_SERVICIO + (metodoEntrega === 'domicilio' ? precioDelivery : 0),
                metodo: metodoPago,
                entrega: metodoEntrega,
                onClose: () => {
                    window.location.href = '/' + window.NEGOCIO_SLUG;
                }
            });
        } else { alert("❌ " + (data.error || "Error al enviar")); }
    } catch(e) { alert("❌ Error de conexión"); }
    finally { btn.textContent = txt; }
}
