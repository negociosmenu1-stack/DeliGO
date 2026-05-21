/* ============================================
   NORTFOOD - SCRIPT BASE (CATÁLOGO & LÓGICA)
   Versión legacy - Solo se activa si catalogo.js no fue cargado.
   Si catalogo.js está presente, este archivo no redefine nada.
   ============================================ */

(function() {
    // Si catalogo.js ya se cargó, no hacer nada para evitar conflictos
    if (window._CATALOGO_JS_LOADED) {
        console.log('script.js: catalogo.js ya cargado, omitiendo definiciones duplicadas');
        return;
    }

    // Variables globales (solo se crean si catalogo.js no está cargado)
    window.carrito = [];
    window.total = 0;
    window.totalCantidad = 0;
    window.categoriaActual = "todas";
    window.generoActual = "";
    window.estadoLocalAbierto = false;

    // --- CARGAR CARRITO DESDE STORAGE ---
    var STORAGE_KEY = 'nortfood_carrito_' + (window.SLUG_NEGOCIO || '');
    window.cargarCarrito = function() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (data) {
                const p = JSON.parse(data);
                window.carrito = p.carrito || [];
                window.total = p.total || 0;
                window.totalCantidad = p.totalCantidad || 0;
            }
        } catch(e) { window.carrito = []; window.total = 0; window.totalCantidad = 0; }
        try { window.actualizarContadores(); } catch(e) { console.error('Error actualizarContadores:', e); }
    };

    window.guardarCarrito = function() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ carrito: window.carrito, total: window.total, totalCantidad: window.totalCantidad })); } catch(e) {}
    };

    window.actualizarContadores = function() {
        let cont = {};
        window.carrito.forEach(i => cont[i.productoId] = (cont[i.productoId] || 0) + 1);
        for(let pid in cont) { const el = document.getElementById('cant-'+pid); if(el) el.innerText = cont[pid]; }
        document.querySelectorAll('[id^="cant-"]').forEach(el => { if(!cont[el.id.replace('cant-','')]) el.innerText = '0'; });
        const cf = document.getElementById('cart-count-float'); if(cf) cf.innerText = window.totalCantidad;
    };

    // --- ESTADO DEL LOCAL (ABIERTO/CERRADO) ---
    window.calcularEstadoLocal = function() {
        const badge = document.getElementById('badge-estado-local');
        if (!badge) return;

        try {
            // Si no hay datos de horarios, el local se considera ABIERTO
            const horarios = window.horariosNegocio;
            if (!horarios || typeof horarios !== 'object' || Object.keys(horarios).length === 0) {
                window.estadoLocalAbierto = true;
                badge.textContent = 'Abierto';
                badge.className = 'badge-estado abierto';
                return;
            }

            const ahora = new Date();
            const diaSemana = ahora.getDay();
            const diaKey = diaSemana === 0 ? '7' : diaSemana.toString();

            const diaData = horarios[diaKey];

            if (!diaData || !diaData.abierto) {
                window.estadoLocalAbierto = false;
                badge.textContent = 'Cerrado';
                badge.className = 'badge-estado cerrado';
                return;
            }

            const horaActual = ahora.getHours().toString().padStart(2, '0') + ':' + ahora.getMinutes().toString().padStart(2, '0');

            const enRango = (apertura, cierre) => {
                if (!apertura || !cierre) return false;
                const [h1, m1] = apertura.split(':').map(Number);
                const [h2, m2] = cierre.split(':').map(Number);
                const [h3, m3] = horaActual.split(':').map(Number);
                const minA = h1 * 60 + m1;
                const minC = h2 * 60 + m2;
                const minAct = h3 * 60 + m3;

                if (minC <= minA) return minAct >= minA || minAct <= minC;
                return minAct >= minA && minAct <= minC;
            };

            window.estadoLocalAbierto = enRango(diaData.apertura, diaData.cierre);

            if (!window.estadoLocalAbierto && diaData.turno2) {
                window.estadoLocalAbierto = enRango(diaData.apertura2, diaData.cierre2);
            }

            badge.textContent = window.estadoLocalAbierto ? 'Abierto' : 'Cerrado';
            badge.className = 'badge-estado ' + (window.estadoLocalAbierto ? 'abierto' : 'cerrado');

        } catch (e) {
            console.error('Error al calcular estado del local:', e);
            window.estadoLocalAbierto = true;
            badge.textContent = 'Abierto';
            badge.className = 'badge-estado abierto';
        }
    };

    // --- CARRITO ---
    window.abrirCarrito = function() {
        if (!window.estadoLocalAbierto) {
            alert("El local se encuentra cerrado en este momento. Horario de atención: toca el botón de horario arriba a la derecha.");
            return;
        }
        if (window.totalCantidad === 0) {
            alert("Tu carrito está vacío. Agrega productos primero.");
            return;
        }
        window.guardarCarrito();
        window.location.href = '/' + window.SLUG_NEGOCIO + '/carrito';
    };

    // --- MODALES ---
    window.abrirModal = function(id) {
        const m = document.getElementById(id);
        if (m) {
            m.style.display = 'flex';
            setTimeout(() => m.classList.add('activo'), 10);
            document.body.classList.add('modal-abierto');
        }
    };
    window.cerrarModal = function(id) {
        const m = document.getElementById(id);
        if (m) {
            m.classList.remove('activo');
            setTimeout(() => { m.style.display = 'none'; }, 300);
            if (!document.querySelector('.modal.activo')) document.body.classList.remove('modal-abierto');
        }
    };

    // Cerrar con ESC o clic fuera
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { const m = document.querySelector('.modal.activo'); if (m) window.cerrarModal(m.id); }});
    document.addEventListener('click', e => { if (e.target.classList.contains('modal')) window.cerrarModal(e.target.id); });

    // --- FILTROS Y BÚSQUEDA ---
    window.filtrarCatalogo = function() { setTimeout(window.aplicarFiltros, 200); };
    window.aplicarFiltros = function() {
        try {
            let busqueda = document.getElementById('buscador')?.value.toLowerCase().trim() || "";
            let tarjetas = document.querySelectorAll('.tarjeta-producto');
            tarjetas.forEach(t => {
                if (t.classList.contains('card-agregar-new')) return;
                let titulo = t.querySelector('.producto-titulo')?.textContent.toLowerCase() || "";
                let cat = t.dataset.categoria || "";
                let matchCat = (window.categoriaActual === "todas" || cat === window.categoriaActual);
                let matchGen = true;
                if (window.RUBRO_NEGOCIO === 'ropa' && window.generoActual && window.generoActual !== "todas") {
                    matchGen = (t.dataset.genero || "").toLowerCase() === window.generoActual.toLowerCase();
                }
                let vis = matchCat && matchGen && titulo.includes(busqueda);
                t.style.display = vis ? 'flex' : 'none';
            });
        } catch(e) { console.error('Error aplicarFiltros:', e); }
    };
    window.filtrarGenero = function(g, el) { window.generoActual = g; document.querySelectorAll('.genero-item').forEach(x => x.classList.remove('activo')); el.classList.add('activo'); window.aplicarFiltros(); };
    window.filtrarCategoria = function(c, el) { window.categoriaActual = c; document.querySelectorAll('.categoria-item').forEach(x => x.classList.remove('activo')); el.classList.add('activo'); window.aplicarFiltros(); };

    // --- DETALLE PRODUCTO ---
    window.abrirDetalleProducto = function(card) {
        const d = card.dataset;
        if (d.stock === 'false') return alert("Producto sin stock");

        window.carrito.push({ productoId: d.productoId, nombre: d.nombre, precio: parseFloat(d.precio), cantidad: 1 });
        window.total += parseFloat(d.precio);
        window.totalCantidad++;
        window.guardarCarrito();
        window.actualizarContadores();

        // Animación botón flotante
        const b = document.querySelector('.carrito-flotante');
        if (b) { b.classList.add('animacion-carrito'); setTimeout(() => b.classList.remove('animacion-carrito'), 300); }
    };

    // --- INIT ---
    document.addEventListener('DOMContentLoaded', () => {
        try { window.cargarCarrito(); } catch(e) { console.error('Error cargarCarrito:', e); }

        try { window.calcularEstadoLocal(); } catch(e) { console.error('Error calcularEstadoLocal:', e); }

        setInterval(() => {
            try { window.calcularEstadoLocal(); } catch(e) { console.error('Error calcularEstadoLocal interval:', e); }
        }, 60000);

        try { window.aplicarFiltros(); } catch(e) { console.error('Error aplicarFiltros:', e); }
    });

    // SEGURIDAD: Si después de 2 segundos el badge sigue diciendo "Calculando...", forzar actualización
    setTimeout(() => {
        const badge = document.getElementById('badge-estado-local');
        if (badge && (badge.textContent === 'Calculando...' || badge.textContent === '')) {
            console.warn('Badge seguía en Calculando, forzando actualización...');
            window.calcularEstadoLocal();
            if (badge.textContent === 'Calculando...' || badge.textContent === '') {
                window.estadoLocalAbierto = true;
                badge.textContent = 'Abierto';
                badge.className = 'badge-estado abierto';
            }
        }
    }, 2000);

})();
