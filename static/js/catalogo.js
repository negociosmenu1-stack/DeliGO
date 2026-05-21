/* ============================================
   NORTFOOD - CATALOGO JS (COMPLETO)
   Estilo Delivery App - Compatible con nuevo HTML
   ============================================ */

// Flag para evitar conflictos con script.js (si ambos se cargan)
window._CATALOGO_JS_LOADED = true;

// ============================================
// CSRF TOKEN HELPER (para fetch requests)
// ============================================
function getCSRFToken() {
    // 1. Buscar en hidden inputs del form
    const csrfInput = document.querySelector('input[name="csrf_token"]');
    if (csrfInput && csrfInput.value) return csrfInput.value;
    // 2. Buscar en meta tag
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    if (metaTag && metaTag.content) return metaTag.content;
    // 3. Buscar en cualquier otro input csrf
    const anyCsrf = document.querySelector('[name="csrf_token"], [name="csrfmiddlewaretoken"]');
    if (anyCsrf && anyCsrf.value) return anyCsrf.value;
    return '';
}

// Helper: fetch con CSRF token incluido automáticamente
function fetchConCSRF(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    const token = getCSRFToken();
    if (token) {
        options.headers['X-CSRFToken'] = token;
    }
    return fetch(url, options);
}

let carrito = [];
let total = 0;
let totalCantidad = 0;
let categoriaActual = "todas";
let generoActual = "";
let estadoLocalAbierto = false;
const STORAGE_KEY = 'nortfood_carrito_' + (window.SLUG_NEGOCIO || '');

// ============================================
// DESCUENTOS
// ============================================
function toggleDescuentoFields(prefix) {
    const checkbox = document.getElementById(prefix + '-descuento-activo');
    const fields = document.getElementById(prefix + '-descuento-fields');
    if (!checkbox || !fields) return;
    fields.style.display = checkbox.checked ? 'block' : 'none';
    if (!checkbox.checked) {
        const valorInput = document.getElementById(prefix + '-valor-descuento');
        if (valorInput) valorInput.value = '';
        const preview = document.getElementById(prefix + '-descuento-preview');
        if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
    } else {
        calcularPreviewDescuento(prefix);
    }
}

function calcularPreviewDescuento(prefix) {
    const precioInput = document.getElementById(prefix + '-precio');
    const valorInput = document.getElementById(prefix + '-valor-descuento');
    const preview = document.getElementById(prefix + '-descuento-preview');
    const tipoPorcentaje = document.getElementById(prefix + '-tipo-porcentaje');
    if (!precioInput || !valorInput || !preview) return;

    const precio = parseFloat(precioInput.value) || 0;
    const valor = parseFloat(valorInput.value) || 0;
    const esPorcentaje = tipoPorcentaje ? tipoPorcentaje.checked : true;

    if (valor <= 0 || precio <= 0) {
        preview.style.display = 'none';
        preview.innerHTML = '';
        return;
    }

    let precioFinal, ahorro;
    if (esPorcentaje) {
        const pct = Math.min(valor, 100);
        ahorro = precio * (pct / 100);
        precioFinal = precio - ahorro;
    } else {
        ahorro = Math.min(valor, precio);
        precioFinal = precio - ahorro;
    }
    if (precioFinal < 0) precioFinal = 0;

    preview.style.display = 'block';
    preview.innerHTML = `<span class="descuento-preview-antes">Antes: $${precio.toFixed(2)}</span> <span class="descuento-preview-ahora">Ahora: $${precioFinal.toFixed(2)}</span> <span class="descuento-preview-ahorro">Ahorrás: $${ahorro.toFixed(2)}</span>`;
}

// Helper: Ensure discount fields are in FormData with correct field names
// This guarantees the backend receives descuento_activo, tipo_descuento, valor_descuento
// regardless of the HTML name attributes or whether fields are inside the <form> tag
function ensureDescuentoFields(formData, prefix) {
    // Remove any existing entries first (avoid duplicates from form fields with wrong names)
    formData.delete('descuento_activo');
    formData.delete('tipo_descuento');
    formData.delete('valor_descuento');

    // Buscar el checkbox de descuento con múltiples IDs posibles
    const checkbox = document.getElementById(prefix + '-descuento-activo')
                  || document.getElementById('descuento-activo')
                  || document.getElementById(prefix + '_descuento_activo')
                  || document.getElementById('descuento_activo');
    
    // Buscar el input de valor con múltiples IDs posibles
    const valorInput = document.getElementById(prefix + '-valor-descuento')
                    || document.getElementById('valor-descuento')
                    || document.getElementById(prefix + '_valor_descuento')
                    || document.getElementById('valor_descuento');
    
    // Buscar radio buttons de tipo con múltiples IDs posibles
    const tipoPorcentaje = document.getElementById(prefix + '-tipo-porcentaje')
                        || document.getElementById('tipo-porcentaje')
                        || document.getElementById(prefix + '_tipo_descuento_porc')
                        || document.querySelector(`input[name="${prefix}-tipo-descuento"][value="porcentaje"]`)
                        || document.querySelector('input[name="tipo-descuento"][value="porcentaje"]')
                        || document.querySelector('input[name="tipo_descuento"][value="porcentaje"]');
    
    const tipoMonto = document.getElementById(prefix + '-tipo-monto')
                   || document.getElementById('tipo-monto')
                   || document.getElementById(prefix + '_tipo_descuento_monto')
                   || document.querySelector(`input[name="${prefix}-tipo-descuento"][value="monto"]`)
                   || document.querySelector('input[name="tipo-descuento"][value="monto"]')
                   || document.querySelector('input[name="tipo_descuento"][value="monto"]');

    if (checkbox && checkbox.checked) {
        formData.append('descuento_activo', 'on');
        // Determine discount type from radio buttons
        if (tipoMonto && tipoMonto.checked) {
            formData.append('tipo_descuento', 'monto');
        } else {
            formData.append('tipo_descuento', 'porcentaje');
        }
        // Discount value
        if (valorInput && valorInput.value && parseFloat(valorInput.value) > 0) {
            formData.append('valor_descuento', valorInput.value);
        } else {
            formData.append('valor_descuento', '0');
        }
    }
    // If checkbox is unchecked, no descuento_activo field is sent
    // (backend defaults to False when field is missing)
}

// Helper: Inject hidden inputs into a form for discount fields (fallback for normal form submit)
function inyectarDescuentoHiddenInputs(form, prefix) {
    // Remove any previously injected hidden inputs
    form.querySelectorAll('.descuento-hidden-injected').forEach(el => el.remove());

    // Buscar elementos con múltiples IDs posibles
    const checkbox = document.getElementById(prefix + '-descuento-activo')
                  || document.getElementById('descuento-activo')
                  || document.getElementById(prefix + '_descuento_activo')
                  || document.getElementById('descuento_activo');
    const valorInput = document.getElementById(prefix + '-valor-descuento')
                    || document.getElementById('valor-descuento')
                    || document.getElementById(prefix + '_valor_descuento')
                    || document.getElementById('valor_descuento');
    const tipoMonto = document.getElementById(prefix + '-tipo-monto')
                   || document.getElementById('tipo-monto')
                   || document.getElementById(prefix + '_tipo_descuento_monto')
                   || document.querySelector(`input[name="${prefix}-tipo-descuento"][value="monto"]`)
                   || document.querySelector('input[name="tipo-descuento"][value="monto"]')
                   || document.querySelector('input[name="tipo_descuento"][value="monto"]');

    // Remove any existing discount fields from the form (wrong name attributes)
    form.querySelectorAll('input[name="descuento_activo"]').forEach(el => el.remove());
    form.querySelectorAll('input[name="tipo_descuento"]').forEach(el => el.remove());
    form.querySelectorAll('input[name="valor_descuento"]').forEach(el => el.remove());

    if (checkbox && checkbox.checked) {
        const hActivo = document.createElement('input');
        hActivo.type = 'hidden'; hActivo.name = 'descuento_activo'; hActivo.value = 'on';
        hActivo.classList.add('descuento-hidden-injected');
        form.appendChild(hActivo);

        const hTipo = document.createElement('input');
        hTipo.type = 'hidden'; hTipo.name = 'tipo_descuento';
        hTipo.value = (tipoMonto && tipoMonto.checked) ? 'monto' : 'porcentaje';
        hTipo.classList.add('descuento-hidden-injected');
        form.appendChild(hTipo);

        const hValor = document.createElement('input');
        hValor.type = 'hidden'; hValor.name = 'valor_descuento';
        hValor.value = (valorInput && valorInput.value && parseFloat(valorInput.value) > 0) ? valorInput.value : '0';
        hValor.classList.add('descuento-hidden-injected');
        form.appendChild(hValor);
    }
}

// ============================================
// BLOQUEAR SWIPE-BACK / VOLVER ATRAS
// ============================================
(function bloquearSwipeBack() {
    // Prevenir el gesto de swipe-back del navegador
    // Agregar entradas al historial para que el back no navegue fuera
    history.pushState(null, '', location.href);
    history.pushState(null, '', location.href);
    window.addEventListener('popstate', function(e) {
        // Si el usuario hace swipe-back o presiona back, lo mantenemos en la misma pagina
        history.pushState(null, '', location.href);
    });
    // Prevenir touch desde el borde izquierdo (swipe-back en iOS/Safari)
    document.addEventListener('touchstart', function(e) {
        if(e.touches[0].clientX < 20) {
            e.preventDefault();
        }
    }, { passive: false });
})();

// Funcion volver atras (para el boton del catalogo)
// Siempre va al home para evitar que vuelva al carrito u otras paginas
function volverAtras() {
    window.location.href = '/';
}

// ============================================
// UTILS & STORAGE
// ============================================
function escapeHTML(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function getCarritoStorageKey() { return STORAGE_KEY; }
function guardarCarritoEnStorage() { try { localStorage.setItem(getCarritoStorageKey(), JSON.stringify({carrito, total, totalCantidad})); } catch(e){} }
function cargarCarritoDesdeStorage() { try { const d = localStorage.getItem(getCarritoStorageKey()); if(d){ const p = JSON.parse(d); carrito=p.carrito||[]; total=p.total||0; totalCantidad=p.totalCantidad||0; } } catch(e){ carrito=[]; total=0; totalCantidad=0; } }

// ============================================
// MODALES
// ============================================
function abrirModal(id) { const m = document.getElementById(id); if(!m) return; m.style.display="flex"; setTimeout(() => m.classList.add('activo'), 10); document.body.classList.add('modal-abierto'); }
function cerrarModal(id) { const m = document.getElementById(id); if(!m) return; m.classList.remove('activo'); setTimeout(() => { m.style.display="none"; }, 300); if(!document.querySelector('.modal.activo')) document.body.classList.remove('modal-abierto'); }
document.addEventListener('keydown', e => { if(e.key==='Escape'){ const m=document.querySelector('.modal.activo'); if(m) cerrarModal(m.id); }});
document.addEventListener('click', e => { if(e.target.classList.contains('modal')) cerrarModal(e.target.id); });

// ============================================
// ESTADO DEL LOCAL (ABIERTO/CERRADO)
// ============================================
function calcularEstadoLocal() {
    const badge = document.getElementById('badge-estado-local');
    if (!badge) return;

    try {
    if (!window.horariosNegocio || typeof window.horariosNegocio !== 'object' || Object.keys(window.horariosNegocio).length === 0) {
        estadoLocalAbierto = true;
        badge.textContent = 'Abierto';
        badge.className = 'badge-estado abierto';
        return;
    }

    const ahora = new Date();
    const diaKey = ahora.getDay() === 0 ? '7' : ahora.getDay().toString();
    const diaData = window.horariosNegocio[diaKey];

    if (!diaData || !diaData.abierto) {
        estadoLocalAbierto = false;
        badge.textContent = 'Cerrado';
        badge.className = 'badge-estado cerrado';
        return;
    }

    const horaActual = ahora.getHours().toString().padStart(2,'0') + ':' + ahora.getMinutes().toString().padStart(2,'0');
    const enRango = (apertura, cierre) => {
        if(!apertura || !cierre) return false;
        const [h1,m1] = apertura.split(':').map(Number);
        const [h2,m2] = cierre.split(':').map(Number);
        const [h3,m3] = horaActual.split(':').map(Number);
        const minA = h1*60+m1, minC = h2*60+m2, minAct = h3*60+m3;
        if(minC <= minA) return minAct >= minA || minAct <= minC;
        return minAct >= minA && minAct <= minC;
    };

    estadoLocalAbierto = enRango(diaData.apertura, diaData.cierre);
    if(!estadoLocalAbierto && diaData.turno2) {
        estadoLocalAbierto = enRango(diaData.apertura2, diaData.cierre2);
    }

    badge.textContent = estadoLocalAbierto ? 'Abierto' : 'Cerrado';
    badge.className = 'badge-estado ' + (estadoLocalAbierto ? 'abierto' : 'cerrado');

    } catch(e) {
        // Si hay cualquier error, mostrar como Abierto para no bloquear ventas
        console.error('Error al calcular estado del local:', e);
        estadoLocalAbierto = true;
        badge.textContent = 'Abierto';
        badge.className = 'badge-estado abierto';
    }
}

// ============================================
// FILTROS
// ============================================
function filtrarCatalogo() { setTimeout(aplicarFiltros, 250); }
function aplicarFiltros() {
    let busqueda = document.getElementById('buscador')?.value.toLowerCase().trim() || "";
    let tarjetas = document.querySelectorAll('#contenedor-productos .cat-product-card');
    // Recolectar IDs en secciones
    const secciones = window.SECCIONES_CATALOGO || [];
    const idsEnSecciones = new Set();
    secciones.forEach(sec => {
        (sec.productos || []).forEach(pid => idsEnSecciones.add(String(pid)));
    });
    let visibles = 0;
    tarjetas.forEach(t => {
        if(t.classList.contains('cat-product-add')) return;
        let titulo = t.querySelector('.cat-product-name')?.textContent.toLowerCase() || "";
        let cat = t.dataset.categoria || "";
        let matchCat = (categoriaActual === "todas" || cat === categoriaActual);
        let matchGen = true;
        if(window.RUBRO_NEGOCIO === 'ropa') {
            if(generoActual && generoActual !== "todas") matchGen = (t.dataset.genero||"").toLowerCase() === generoActual.toLowerCase();
        }
        let vis = matchCat && matchGen && titulo.includes(busqueda);
        // Si el producto esta en una seccion, ocultarlo de la lista plana
        if(idsEnSecciones.has(String(t.dataset.productoId)) && secciones.length) {
            t.style.display = 'none';
        } else {
            t.style.display = vis ? 'flex' : 'none';
        }
        if(vis) visibles++;
    });
    actualizarVisibilidadSecciones();
}
function filtrarGenero(g, el) {
    generoActual = g;
    document.querySelectorAll('.generos-bar .cat-pill').forEach(x=>x.classList.remove('activo'));
    el.classList.add('activo');
    aplicarFiltros();
}
function filtrarCategoria(c, el) {
    categoriaActual = c;
    document.querySelectorAll('.categorias-bar .cat-pill').forEach(x=>x.classList.remove('activo'));
    el.classList.add('activo');
    aplicarFiltros();
}

// ============================================
// EDITAR / ELIMINAR CATEGORIAS
// ============================================
function abrirEditarCategoria(nombreCategoria) {
    document.getElementById('edit-cat-original').value = nombreCategoria;
    document.getElementById('edit-cat-nombre').value = nombreCategoria;
    abrirModal('modal-editar-categoria');
}

async function guardarEditarCategoria(e) {
    e.preventDefault();
    const original = document.getElementById('edit-cat-original').value;
    const nueva = document.getElementById('edit-cat-nombre').value.trim();
    if (!nueva) { alert('El nombre no puede estar vacío'); return; }
    if (nueva === original) { cerrarModal('modal-editar-categoria'); return; }

    try {
        const resp = await fetch('/api/editar-categoria/' + window.SLUG_NEGOCIO, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoria_original: original, categoria_nueva: nueva })
        });
        const data = await resp.json();
        if (data.ok) {
            // Actualizar el pill en el DOM
            const pill = document.querySelector(`.cat-pill-categoria[data-categoria="${CSS.escape(original)}"]`);
            if (pill) {
                pill.dataset.categoria = nueva;
                pill.querySelector('.cat-pill-nombre').textContent = nueva;
                pill.querySelector('.cat-pill-gear').setAttribute('onclick', `event.stopPropagation(); abrirEditarCategoria('${nueva.replace(/'/g, "\\'")}')`);
                pill.setAttribute('onclick', `filtrarCategoria('${nueva.replace(/'/g, "\\'")}', this)`);
            }
            // Actualizar productos en el DOM
            document.querySelectorAll(`.cat-product-card[data-categoria="${CSS.escape(original)}"]`).forEach(card => {
                card.dataset.categoria = nueva;
            });
            // Actualizar data-categoria-nombre
            document.querySelectorAll(`.cat-product-card[data-categoria-nombre="${CSS.escape(original)}"]`).forEach(card => {
                card.dataset.categoriaNombre = nueva;
            });
            // Actualizar selects de categoría en formularios
            document.querySelectorAll('#edit-categoria option, #nuevo-categoria option').forEach(opt => {
                if (opt.value === original) { opt.value = nueva; opt.textContent = nueva; }
            });
            // Si estábamos filtrando por esa categoría, actualizar
            if (categoriaActual === original) categoriaActual = nueva;
            cerrarModal('modal-editar-categoria');
        } else {
            alert(data.error || 'Error al guardar');
        }
    } catch(err) {
        alert('Error de conexión');
    }
}

async function eliminarCategoria(e) {
    e.preventDefault();
    const original = document.getElementById('edit-cat-original').value;
    if (!confirm(`¿Eliminar la categoría "${original}"? Los productos pasarán a "Sin Categoria".`)) return;

    try {
        const resp = await fetch('/api/eliminar-categoria/' + window.SLUG_NEGOCIO, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ categoria: original })
        });
        const data = await resp.json();
        if (data.ok) {
            // Eliminar el pill del DOM
            const pill = document.querySelector(`.cat-pill-categoria[data-categoria="${CSS.escape(original)}"]`);
            if (pill) pill.remove();
            // Mover productos a "Sin Categoria"
            document.querySelectorAll(`.cat-product-card[data-categoria="${CSS.escape(original)}"]`).forEach(card => {
                card.dataset.categoria = 'Sin Categoria';
                card.dataset.categoriaNombre = 'Sin Categoria';
            });
            // Actualizar selects
            document.querySelectorAll('#edit-categoria option, #nuevo-categoria option').forEach(opt => {
                if (opt.value === original) opt.remove();
            });
            // Si estábamos filtrando, ir a Todas
            if (categoriaActual === original) {
                categoriaActual = 'todas';
                document.querySelectorAll('.categorias-bar .cat-pill').forEach(x => x.classList.remove('activo'));
                document.querySelector('.categorias-bar .cat-pill').classList.add('activo');
                aplicarFiltros();
            }
            // Mostrar "Sin Categoria" pill si no existe y hay productos sin categoría
            const sinCatPill = document.querySelector('.cat-pill[onclick*="Sin Categoria"]');
            const sinCatProducts = document.querySelectorAll('.cat-product-card[data-categoria="Sin Categoria"]');
            if (!sinCatPill && sinCatProducts.length > 0) {
                const bar = document.getElementById('categorias-bar');
                const addBtn = bar.querySelector('.cat-pill-add');
                const newPill = document.createElement('div');
                newPill.className = 'cat-pill';
                newPill.setAttribute('onclick', "filtrarCategoria('Sin Categoria', this)");
                newPill.setAttribute('role', 'tab');
                newPill.textContent = 'Sin Categoria';
                bar.insertBefore(newPill, addBtn);
            }
            cerrarModal('modal-editar-categoria');
        } else {
            alert(data.error || 'Error al eliminar');
        }
    } catch(err) {
        alert('Error de conexión');
    }
}

// ============================================
// SECCIONES DE CATALOGO
// ============================================

// Funcion para abrir el editor inline de una seccion
function editarSeccionInline(nombreSeccion) {
    const secciones = window.SECCIONES_CATALOGO || [];
    const sec = secciones.find(s => s.nombre === nombreSeccion);
    if(!sec) return;

    const secEl = document.querySelector(`.seccion-catalogo[data-seccion-nombre="${CSS.escape(nombreSeccion)}"]`);
    if(!secEl) return;

    // Si ya esta en modo edicion, cancelar
    if(secEl.querySelector('.seccion-inline-editor')) return;

    const colorActual = sec.color || '#f4f6f8';
    const orientacionActual = sec.orientacion || 'horizontal';
    const productosActuales = (sec.productos || []).map(id => String(id));

    // Recolectar todos los productos disponibles
    const todasLasTarjetas = document.querySelectorAll('#contenedor-productos .cat-product-card:not(.cat-product-add)');
    let productosOptions = '';
    todasLasTarjetas.forEach(t => {
        const pid = String(t.dataset.productoId);
        const nombre = t.querySelector('.cat-product-name')?.textContent || '';
        const checked = productosActuales.includes(pid) ? 'checked' : '';
        productosOptions += `<label class="seccion-prod-check"><input type="checkbox" class="inline-edit-prod-cb" value="${pid}" ${checked}><span>${escapeHTML(nombre)}</span></label>`;
    });

    // Construir el formulario inline
    const editor = document.createElement('div');
    editor.className = 'seccion-inline-editor';
    editor.innerHTML = `
        <div class="seccion-inline-editor-inner">
            <div class="seccion-inline-row">
                <label>Nombre:</label>
                <input type="text" class="inline-edit-nombre" value="${escapeHTML(nombreSeccion)}" placeholder="Nombre de la seccion">
            </div>
            <div class="seccion-inline-row">
                <label>Orientacion:</label>
                <select class="inline-edit-orientacion">
                    <option value="horizontal" ${orientacionActual === 'horizontal' ? 'selected' : ''}>Horizontal</option>
                    <option value="vertical" ${orientacionActual === 'vertical' ? 'selected' : ''}>Vertical</option>
                </select>
            </div>
            <div class="seccion-inline-row">
                <label>Color:</label>
                <div class="seccion-inline-color-row">
                    <input type="color" class="inline-edit-color" value="${colorActual}">
                    <span class="seccion-inline-color-preview" style="background:${colorActual};"></span>
                </div>
            </div>
            <div class="seccion-inline-row">
                <label>Productos:</label>
                <div class="seccion-inline-productos-list">${productosOptions || '<p style="font-size:12px;color:#999;">No hay productos.</p>'}</div>
            </div>
            <div class="seccion-inline-row" style="flex-direction:column;align-items:stretch;">
                <label style="margin-bottom:6px;">Listas de Ingredientes:</label>
                <p style="font-size:11px;color:#999;margin:0 0 6px;">Ingredientes compartidos por los productos de esta seccion.</p>
                <div class="inline-edit-listas-container"></div>
                <input type="hidden" class="inline-edit-listas-json" value="">
                <button type="button" onclick="agregarListaSeccionEdit('${escapeHTML(nombreSeccion)}')" style="background:var(--color-principal);color:white;border:none;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:700;font-size:12px;margin-top:6px;">+ Agregar Lista</button>
            </div>
            <div class="seccion-inline-acciones">
                <button type="button" class="seccion-inline-btn seccion-inline-btn-guardar" onclick="guardarSeccionInline('${escapeHTML(nombreSeccion)}')">Guardar</button>
                <button type="button" class="seccion-inline-btn seccion-inline-btn-cancelar" onclick="cancelarSeccionInline()">Cancelar</button>
                <button type="button" class="seccion-inline-btn seccion-inline-btn-eliminar" onclick="eliminarSeccionInline('${escapeHTML(nombreSeccion)}')">Eliminar</button>
            </div>
        </div>
    `;

    // Actualizar preview de color en tiempo real
    const colorInput = editor.querySelector('.inline-edit-color');
    const colorPreview = editor.querySelector('.seccion-inline-color-preview');
    colorInput.addEventListener('input', () => {
        colorPreview.style.background = colorInput.value;
    });

    // Ocultar el contenido de la seccion y mostrar el editor
    const header = secEl.querySelector('.seccion-catalogo-header');
    const content = secEl.querySelector('.seccion-catalogo-horizontal, .seccion-catalogo-vertical');
    if(header) header.style.display = 'none';
    if(content) content.style.display = 'none';
    secEl.appendChild(editor);

    // Populate existing ingredient lists
    const listasExistentes = sec.listas_ingredientes || [];
    seccionListasEdit[nombreSeccion] = JSON.parse(JSON.stringify(listasExistentes));
    seccionListasEdit[nombreSeccion].forEach((lista, idx) => {
        renderListaSeccion('edit-' + nombreSeccion, idx, lista);
    });
    sincronizarListasSeccion('edit-' + nombreSeccion);
}

// Funcion para guardar los cambios de una seccion editada inline
function guardarSeccionInline(nombreViejo) {
    const secEl = document.querySelector(`.seccion-catalogo[data-seccion-nombre="${CSS.escape(nombreViejo)}"]`);
    if(!secEl) return;

    const editor = secEl.querySelector('.seccion-inline-editor');
    if(!editor) return;

    const nombreNuevo = editor.querySelector('.inline-edit-nombre').value.trim();
    const orientacion = editor.querySelector('.inline-edit-orientacion').value;
    const color = editor.querySelector('.inline-edit-color').value;
    const productosSeleccionados = [];
    editor.querySelectorAll('.inline-edit-prod-cb:checked').forEach(cb => {
        productosSeleccionados.push(cb.value);
    });

    if(!nombreNuevo) {
        alert('El nombre de la seccion es obligatorio');
        return;
    }

    // Enviar via fetch
    const formData = new URLSearchParams();
    formData.append('nombre_viejo', nombreViejo);
    formData.append('nombre_nuevo', nombreNuevo);
    formData.append('orientacion', orientacion);
    formData.append('color_seccion', color);
    productosSeleccionados.forEach(pid => formData.append('productos_seccion', pid));

    // Agregar listas de ingredientes
    const listasJson = editor.querySelector('.inline-edit-listas-json');
    if (listasJson) formData.append('listas_ingredientes', listasJson.value);

    fetchConCSRF(`/editar-seccion-catalogo/${window.SLUG_NEGOCIO}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
    }).then(res => {
        if(res.ok) {
            window.location.reload();
        } else {
            alert('Error al guardar la seccion');
        }
    }).catch(() => {
        alert('Error de conexion al guardar la seccion');
    });
}

// Funcion para cancelar la edicion inline
function cancelarSeccionInline() {
    const editor = document.querySelector('.seccion-inline-editor');
    if(!editor) return;
    const secEl = editor.closest('.seccion-catalogo');
    if(!secEl) return;

    // Restaurar la vista normal
    const header = secEl.querySelector('.seccion-catalogo-header');
    const content = secEl.querySelector('.seccion-catalogo-horizontal, .seccion-catalogo-vertical');
    if(header) header.style.display = '';
    if(content) content.style.display = '';
    editor.remove();
}

// Funcion para eliminar una seccion inline
function eliminarSeccionInline(nombreSeccion) {
    if(!confirm(`Eliminar la seccion "${nombreSeccion}"?`)) return;

    const formData = new URLSearchParams();
    formData.append('nombre', nombreSeccion);

    fetchConCSRF(`/eliminar-seccion-catalogo/${window.SLUG_NEGOCIO}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
    }).then(res => {
        if(res.ok) {
            window.location.reload();
        } else {
            alert('Error al eliminar la seccion');
        }
    }).catch(() => {
        alert('Error de conexion al eliminar la seccion');
    });
}

// Renderizar las secciones del catalogo agrupando productos por ID
function renderizarSeccionesCatalogo() {
    const secciones = window.SECCIONES_CATALOGO || [];
    if(!secciones.length) {
        document.getElementById('contenedor-secciones-catalogo').innerHTML = '';
        return;
    }

    const contenedor = document.getElementById('contenedor-secciones-catalogo');
    const todasLasTarjetas = document.querySelectorAll('#contenedor-productos .cat-product-card:not(.cat-product-add)');
    const esOwner = !!window.SLUG_NEGOCIO && document.querySelector('.menu-dropdown-container');

    // Recolectar IDs ya asignados a alguna seccion
    const idsEnSecciones = new Set();
    secciones.forEach(sec => {
        (sec.productos || []).forEach(pid => idsEnSecciones.add(String(pid)));
    });

    let html = '';

    secciones.forEach(sec => {
        const productosIds = (sec.productos || []).map(pid => String(pid));
        const esHorizontal = sec.orientacion !== 'vertical';
        const claseOrientacion = esHorizontal ? 'seccion-catalogo-horizontal' : 'seccion-catalogo-vertical';
        const colorFondo = sec.color || '#f4f6f8';

        // Buscar las tarjetas que coincidan con los IDs de esta seccion
        const tarjetasSeccion = [];
        todasLasTarjetas.forEach(t => {
            const prodId = String(t.dataset.productoId);
            if(productosIds.includes(prodId)) {
                tarjetasSeccion.push(t);
            }
        });

        if(!tarjetasSeccion.length) return; // No mostrar seccion vacia

        html += `<div class="seccion-catalogo" data-seccion-nombre="${escapeHTML(sec.nombre)}" style="background:${colorFondo};">`;
        html += `<div class="seccion-catalogo-header">`;
        html += `<h3>${escapeHTML(sec.nombre)}</h3>`;
        html += `<div class="seccion-catalogo-header-right">`;
        if(esHorizontal) {
            html += `<span class="seccion-scroll-hint">Desliza &rsaquo;</span>`;
        }
        // Botones de edicion inline (solo para el owner)
        if(esOwner) {
            html += `<button class="seccion-inline-edit-btn" onclick="editarSeccionInline('${escapeHTML(sec.nombre)}')" title="Editar seccion">&#9998;</button>`;
            html += `<button class="seccion-inline-delete-btn" onclick="eliminarSeccionInline('${escapeHTML(sec.nombre)}')" title="Eliminar seccion">&#10005;</button>`;
        }
        html += `</div>`;
        html += `</div>`;
        html += `<div class="${claseOrientacion}" id="seccion-scroll-${escapeHTML(sec.nombre).replace(/[^a-zA-Z0-9]/g,'-')}">`;

        tarjetasSeccion.forEach(t => {
            const clon = t.cloneNode(true);
            clon.style.display = 'flex';
            // Re-asignar eventos de botones
            clon.querySelectorAll('.cat-qty-btn').forEach(btn => {
                const pid = btn.dataset.productoId;
                if(btn.classList.contains('cat-qty-minus')) {
                    btn.onclick = (e) => { e.stopPropagation(); eliminarDelCarrito(pid); };
                }
            });
            clon.querySelectorAll('.cat-product-options').forEach(btn => {
                btn.onclick = (e) => { e.stopPropagation(); abrirEditarProducto(btn); };
            });
            clon.querySelectorAll('.cat-product-img, .cat-product-info').forEach(el => {
                el.onclick = () => abrirDetalleProducto(el.closest('.cat-product-card'));
            });
            clon.querySelectorAll('.cat-qty-plus').forEach(btn => {
                btn.onclick = (e) => { e.stopPropagation(); abrirDetalleProducto(btn.closest('.cat-product-card')); };
            });
            html += clon.outerHTML;
        });

        html += `</div></div>`;
    });

    contenedor.innerHTML = html;

    // Ocultar las tarjetas originales de la lista plana si estan en alguna seccion
    todasLasTarjetas.forEach(t => {
        if(idsEnSecciones.has(String(t.dataset.productoId))) {
            t.style.display = 'none';
        }
    });
}

// Funcion para mostrar/ocultar secciones segun filtro de categoria
function actualizarVisibilidadSecciones() {
    const secciones = window.SECCIONES_CATALOGO || [];
    if(!secciones.length) return;

    document.querySelectorAll('.seccion-catalogo').forEach(secEl => {
        // No filtrar secciones que estan en modo edicion
        if(secEl.querySelector('.seccion-inline-editor')) return;

        const tarjetas = secEl.querySelectorAll('.cat-product-card');
        let algunaVisible = false;
        tarjetas.forEach(t => {
            const cat = t.dataset.categoria || '';
            const titulo = t.querySelector('.cat-product-name')?.textContent.toLowerCase() || '';
            const busqueda = document.getElementById('buscador')?.value.toLowerCase().trim() || '';
            let matchCat = (categoriaActual === "todas" || cat === categoriaActual);
            let matchGen = true;
            if(window.RUBRO_NEGOCIO === 'ropa') {
                if(generoActual && generoActual !== "todas") matchGen = (t.dataset.genero||"").toLowerCase() === generoActual.toLowerCase();
            }
            let vis = matchCat && matchGen && titulo.includes(busqueda);
            t.style.display = vis ? 'flex' : 'none';
            if(vis) algunaVisible = true;
        });
        secEl.style.display = algunaVisible ? 'block' : 'none';
    });
}

// ============================================
// CARRITO
// ============================================
document.addEventListener('click', e => {
    const btn = e.target.closest('.cat-qty-btn');
    if(btn && !btn.closest('.detalle-cantidad') && !btn.closest('#modal-eliminar-item')) {
        const pid = btn.dataset.productoId;
        if(btn.classList.contains('cat-qty-plus')) {
            const t = document.querySelector(`.cat-product-card[data-producto-id="${pid}"]`);
            if(t) abrirDetalleProducto(t);
        }
        else eliminarDelCarrito(pid);
    }
});
function eliminarDelCarrito(pid) {
    // Buscar todos los items de este producto en el carrito
    const itemsDelProducto = carrito
        .map((item, idx) => ({ ...item, _idx: idx }))
        .filter(i => i.productoId === pid);

    if(itemsDelProducto.length === 0) return;

    // Si solo hay 1 item, lo borramos directo
    if(itemsDelProducto.length === 1) {
        carrito.splice(itemsDelProducto[0]._idx, 1);
        recalcularCarrito();
        return;
    }

    // Si hay varios items, siempre mostrar modal para elegir cual sacar
    if(itemsDelProducto.length > 1) {
        mostrarModalEliminarItem(itemsDelProducto, pid);
    } else {
        carrito.splice(itemsDelProducto[0]._idx, 1);
        recalcularCarrito();
    }
}

function mostrarModalEliminarItem(items, pid) {
    // Crear o reutilizar modal
    let modal = document.getElementById('modal-eliminar-item');
    if(!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-eliminar-item';
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        document.body.appendChild(modal);
    }
    const nombreProducto = items[0].nombre || 'Producto';
    let html = `<div class="modal-contenido" style="max-width:380px;">
        <span class="cerrar" onclick="cerrarModal('modal-eliminar-item')" role="button">&times;</span>
        <h3 style="text-align:center;margin-top:0;">¿Cuál querés sacar?</h3>
        <p style="text-align:center;font-size:13px;color:#666;margin-bottom:12px;">Tenés ${items.length} unidades de <strong>${escapeHTML(nombreProducto)}</strong></p>
        <div style="max-height:300px;overflow-y:auto;">`;

    items.forEach((item, i) => {
        let descripcion = '';
        const detalles = [];
        if(item.talle) detalles.push(`Talle: ${escapeHTML(item.talle)}`);
        if(item.color) detalles.push(`Color: ${escapeHTML(item.color)}`);
        if(item.secciones) {
            for(const sec in item.secciones) {
                const opts = Array.isArray(item.secciones[sec]) ? item.secciones[sec].join(', ') : item.secciones[sec];
                detalles.push(`${escapeHTML(sec)}: ${escapeHTML(opts)}`);
            }
        }
        if(item.agregados && item.agregados.length > 0) {
            item.agregados.forEach(a => detalles.push(`+ ${escapeHTML(a.nombre)} ($${a.precio.toFixed(2)})`));
        }
        // Si no hay opciones distintas, mostrar numero de unidad
        if(detalles.length > 0) {
            descripcion = detalles.join(' · ') + ' · $' + item.precio.toFixed(2);
        } else {
            descripcion = `Unidad #${i + 1} · $${item.precio.toFixed(2)}`;
        }

        html += `<button onclick="confirmarEliminarItem(${item._idx})" class="eliminar-item-option" style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 14px;margin-bottom:8px;border:1.5px solid #e0e0e0;border-radius:12px;background:#fff;cursor:pointer;text-align:left;transition:all 0.15s ease;" onmouseover="this.style.borderColor='var(--color-principal)'" onmouseout="this.style.borderColor='#e0e0e0'">
            <span style="font-size:13px;flex:1;">${descripcion}</span>
            <span style="color:#e74c3c;font-weight:700;font-size:18px;margin-left:10px;">&times;</span>
        </button>`;
    });

    html += `</div></div>`;
    modal.innerHTML = html;
    abrirModal('modal-eliminar-item');
}

function confirmarEliminarItem(idx) {
    carrito.splice(idx, 1);
    recalcularCarrito();
    cerrarModal('modal-eliminar-item');
}
function recalcularCarrito() {
    total = 0; totalCantidad = carrito.length;
    let contadores = {};
    carrito.forEach(i => contadores[i.productoId] = (contadores[i.productoId]||0)+1);
    for(let pid in contadores) { document.querySelectorAll(`.cat-qty-num[data-producto-id="${pid}"]`).forEach(el => el.innerText = contadores[pid]); }
    document.querySelectorAll('.cat-qty-num[data-producto-id]').forEach(el => { const p = el.dataset.productoId; if(!contadores[p]) el.innerText = '0'; });
    const cf = document.getElementById('cart-count-float'); if(cf) cf.innerText = totalCantidad;
    guardarCarritoEnStorage();
}
function abrirCarrito() {
    if (!estadoLocalAbierto) {
        alert("El local se encuentra cerrado en este momento. Horario de atención: toca el botón de horario arriba a la derecha.");
        return;
    }
    if (totalCantidad === 0) {
        alert("Tu carrito está vacío. Agrega productos primero.");
        return;
    }
    guardarCarritoEnStorage();
    window.location.href = '/' + window.SLUG_NEGOCIO + '/carrito';
}

// ============================================
// DETALLE PRODUCTO
// ============================================
let detalleState = { productoId:'', nombre:'', precio:0, imagenes:[], fotoActual:0, talle:'', color:'', agregados:[], secciones:{}, seccionesPrecios:{}, ingredientes:[], ingredientesQuitados:[], listasSeccion:[], listasSeccionQuitados:{}, cant:1, yaEnCarrito:0, recomendados:[] };
let colaRecomendados = []; // Cola de productos recomendados para abrir en cascada
let detalleEsCascada = false; // Flag: detalle abierto desde cascada (sin recomendados propios)

function abrirDetalleProducto(card, esCascada) {
    detalleEsCascada = !!esCascada;
    if(!esCascada) colaRecomendados = []; // Limpiar cola al abrir desde catalogo
    const d = card.dataset;
    if(d.stock === 'false') { alert("Producto sin stock"); return; }

    const qtyEnCarrito = carrito.filter(i=>i.productoId===d.productoId).length;
    const tieneDescuento = d.descuentoActivo === 'true';
    const precioPromo = tieneDescuento && d.precioPromo ? parseFloat(d.precioPromo) : null;
    const precioEfectivo = precioPromo !== null ? precioPromo : parseFloat(d.precio);
    detalleState = { productoId:d.productoId, nombre:d.nombre, precio:precioEfectivo, precioOriginal:parseFloat(d.precio), tieneDescuento:tieneDescuento, tipoDescuento:d.tipoDescuento||'porcentaje', valorDescuento:parseFloat(d.valorDescuento)||0, imagenes:[], fotoActual:0, talle:'', color:'', agregados:[], secciones:{}, seccionesPrecios:{}, ingredientes:[], ingredientesQuitados:[], listasSeccion:[], listasSeccionQuitados:{}, cant: 1, yaEnCarrito: qtyEnCarrito, recomendados:[] };
    let imgs = (d.imagenes || d.imagenPrincipal) ? (d.imagenes || d.imagenPrincipal).split(',').filter(u=>u.trim()) : [];
    detalleState.imagenes = imgs.length ? imgs : (d.imagenPrincipal ? [d.imagenPrincipal] : []);

    document.getElementById('titulo-detalle-prod').textContent = detalleState.nombre;
    document.getElementById('detalle-categoria').textContent = d.categoriaNombre || d.categoria || '';
    // Mostrar precio con descuento
    const precioEl = document.getElementById('detalle-precio');
    const precioOrigEl = document.getElementById('detalle-precio-original');
    const badgeDescEl = document.getElementById('detalle-badge-descuento');
    if(tieneDescuento && precioPromo !== null) {
        precioEl.textContent = '$' + precioPromo.toFixed(2);
        precioEl.classList.add('detalle-precio-promo');
        precioOrigEl.textContent = '$' + parseFloat(d.precio).toFixed(2);
        precioOrigEl.style.display = 'inline';
        let descTexto = '';
        if(detalleState.tipoDescuento === 'porcentaje') {
            descTexto = '-' + Math.round(detalleState.valorDescuento) + '%';
        } else {
            descTexto = '-$' + detalleState.valorDescuento.toFixed(0);
        }
        badgeDescEl.textContent = descTexto;
        badgeDescEl.style.display = 'inline-block';
    } else {
        precioEl.textContent = '$' + detalleState.precio.toFixed(2);
        precioEl.classList.remove('detalle-precio-promo');
        precioOrigEl.style.display = 'none';
        badgeDescEl.style.display = 'none';
    }
    renderDetalleGaleria();

    // Mostrar secciones segun rubro
    document.getElementById('detalle-seccion-ropa').style.display = (window.RUBRO_NEGOCIO==='ropa') ? 'block' : 'none';
    document.getElementById('detalle-seccion-restaurante').style.display = (window.RUBRO_NEGOCIO==='restaurante') ? 'block' : 'none';

    // Controlar visibilidad de contenedores
    if(window.RUBRO_NEGOCIO==='ropa') poblarRopa(d);
    else if(window.RUBRO_NEGOCIO==='restaurante') poblarRestaurante(d);

    const sinStock = document.getElementById('detalle-sin-stock');
    const controles = document.getElementById('detalle-controles');
    const btn = document.getElementById('detalle-btn-agregar');
    if(d.stock==='false') { sinStock.style.display='block'; controles.style.display='none'; btn.style.display='none'; }
    else { sinStock.style.display='none'; controles.style.display='flex'; btn.style.display='block'; }

    document.getElementById('detalle-cant-numero').textContent = detalleState.cant;
    actualizarIndicadorCarritoDetalle();
    actualizarDetalleTotal();
    document.getElementById('detalle-btn-mas').onclick = () => { detalleState.cant++; document.getElementById('detalle-cant-numero').textContent = detalleState.cant; actualizarDetalleTotal(); };
    document.getElementById('detalle-btn-menos').onclick = () => { if(detalleState.cant>1) { detalleState.cant--; document.getElementById('detalle-cant-numero').textContent = detalleState.cant; actualizarDetalleTotal(); } };
    abrirModal('modal-detalle-producto');
}

function cancelarDetalle() {
    cerrarModal('modal-detalle-producto');
    // Al cancelar, limpiar la cola de recomendados pendientes
    colaRecomendados = [];
    detalleEsCascada = false;
}

function renderDetalleGaleria() {
    const galeria = document.querySelector('.detalle-galeria');
    const img = document.getElementById('detalle-img-principal');
    const indicador = document.getElementById('detalle-foto-indicador');
    if(detalleState.imagenes.length) {
        detalleState.fotoActual=0; img.src=detalleState.imagenes[0];
        img.style.display = 'block';
        if(galeria) galeria.classList.remove('sin-imagen');
        const ph = galeria?.querySelector('.detalle-img-placeholder');
        if(ph) ph.remove();
    } else {
        img.src = ''; img.style.display = 'none';
        if(galeria) {
            galeria.classList.add('sin-imagen');
            if(!galeria.querySelector('.detalle-img-placeholder')) {
                const ph = document.createElement('div');
                ph.className = 'detalle-img-placeholder';
                ph.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
                galeria.appendChild(ph);
            }
        }
    }
    const thumbs = document.getElementById('detalle-thumbnails'); thumbs.innerHTML='';
    detalleState.imagenes.forEach((u,i) => {
        const t = document.createElement('div'); t.className = 'detalle-thumb'+(i===0?' activo':'');
        t.innerHTML = `<img src="${escapeHTML(u)}" loading="lazy">`; t.onclick = ()=>detalleIrAFoto(i); thumbs.appendChild(t);
    });
    if(indicador) indicador.textContent = detalleState.imagenes.length > 1 ? `1 / ${detalleState.imagenes.length}` : '';
    const prevBtn = document.querySelector('.detalle-galeria-prev');
    const nextBtn = document.querySelector('.detalle-galeria-next');
    if(prevBtn) prevBtn.classList.toggle('oculto', detalleState.imagenes.length<=1);
    if(nextBtn) nextBtn.classList.toggle('oculto', detalleState.imagenes.length<=1);
}
function detalleIrAFoto(i) { detalleState.fotoActual=i; document.getElementById('detalle-img-principal').src=detalleState.imagenes[i]; document.querySelectorAll('.detalle-thumb').forEach((t,idx)=>t.classList.toggle('activo',idx===i)); const indicador = document.getElementById('detalle-foto-indicador'); if(indicador) indicador.textContent = `${i+1} / ${detalleState.imagenes.length}`; }
function detalleCambiarFoto(dir) { if(!detalleState.imagenes.length) return; detalleIrAFoto((detalleState.fotoActual + dir + detalleState.imagenes.length) % detalleState.imagenes.length); }

function poblarRopa(d) {
    const crearChips = (arr, target, setFn) => {
        if(!arr || !arr.length) { if(target) target.parentElement.style.display='none'; return; }
        if(target) target.parentElement.style.display='';
        target.innerHTML='';
        arr.forEach(v => {
            if(!v.trim()) return;
            const b=document.createElement('button'); b.className='detalle-chip'; b.textContent=v.trim();
            b.onclick=()=>{ target.querySelectorAll('.detalle-chip').forEach(x=>x.classList.remove('seleccionado')); b.classList.add('seleccionado'); setFn(v.trim()); };
            target.appendChild(b);
        });
    };
    crearChips(d.talles?.split(','), document.getElementById('detalle-talles'), v=>detalleState.talle=v);
    crearChips(d.colores?.split(','), document.getElementById('detalle-colores'), v=>detalleState.color=v);

    const matContainer = document.getElementById('detalle-material-container');
    const genContainer = document.getElementById('detalle-genero-container');
    if(matContainer) { if(d.material) { matContainer.style.display=''; document.getElementById('detalle-material').textContent = d.material; } else { matContainer.style.display='none'; } }
    if(genContainer) { if(d.genero) { genContainer.style.display=''; document.getElementById('detalle-genero').textContent = d.genero; } else { genContainer.style.display='none'; } }
}

function poblarRestaurante(d) {
    // Descripcion
    const descCont = document.getElementById('detalle-descripcion-container');
    if(descCont) { if(d.descripcion) { descCont.style.display=''; document.getElementById('detalle-descripcion').textContent = d.descripcion; } else { descCont.style.display='none'; } }

    // Agregados
    const agrCont = document.getElementById('detalle-agregados-global');
    const agrContWrapper = document.getElementById('detalle-agregados-global-container');
    agrCont.innerHTML='';
    let agrIds = (d.agregadosIds||'').split(',').filter(v=>v.trim());
    let hasAgregados = false;
    if(window.AGREGADOS_DATA) {
        window.AGREGADOS_DATA.filter(a=>agrIds.includes(a._id)).forEach(a => {
            hasAgregados = true;
            const div = document.createElement('div'); div.className='detalle-agregado-item';
            div.innerHTML=`<span>${escapeHTML(a.nombre)}</span><span style="margin-left:auto; color:var(--color-principal); font-weight:700;">+$${a.precio.toFixed(2)}</span>`;
            div.onclick = () => {
                div.classList.toggle('seleccionado');
                if(div.classList.contains('seleccionado')) detalleState.agregados.push({nombre:a.nombre, precio:a.precio});
                else detalleState.agregados=detalleState.agregados.filter(x=>x.nombre!==a.nombre);
                actualizarDetalleTotal();
            };
            agrCont.appendChild(div);
        });
    }
    if(agrContWrapper) agrContWrapper.style.display = hasAgregados ? '' : 'none';

    // Ingredientes (checkboxes, marcados por defecto) — desde pool global
    const ingCont = document.getElementById('detalle-ingredientes');
    const ingContWrapper = document.getElementById('detalle-ingredientes-container');
    ingCont.innerHTML = '';
    detalleState.ingredientes = [];
    detalleState.ingredientesQuitados = [];
    let ingIds = (d.ingredientesIds||'').split(',').filter(v=>v.trim());
    let hasIngredientes = false;
    if(window.INGREDIENTES_DATA && ingIds.length > 0) {
        window.INGREDIENTES_DATA.filter(i=>ingIds.includes(i._id)).forEach(ing => {
            hasIngredientes = true;
            const nombre = ing.nombre;
            detalleState.ingredientes.push(nombre);
            const label = document.createElement('label');
            label.className = 'detalle-ingrediente-item';
            const imgHtml = ing.imagen_url ? `<img src="${ing.imagen_url}" alt="${escapeHTML(nombre)}" class="detalle-ingrediente-img">` : '';
            label.innerHTML = `<input type="checkbox" checked data-ingrediente="${escapeHTML(nombre)}"><span class="check-icon"></span>${imgHtml}<span>${escapeHTML(nombre)}</span>`;
            const cb = label.querySelector('input');
            cb.addEventListener('change', function() {
                label.classList.toggle('unchecked', !this.checked);
                if(!this.checked) {
                    if(!detalleState.ingredientesQuitados.includes(nombre)) {
                        detalleState.ingredientesQuitados.push(nombre);
                    }
                } else {
                    detalleState.ingredientesQuitados = detalleState.ingredientesQuitados.filter(i => i !== nombre);
                }
            });
            ingCont.appendChild(label);
        });
    }
    if(ingContWrapper) ingContWrapper.style.display = hasIngredientes ? '' : 'none';

    // Listas de ingredientes de la sección del catálogo
    const listasSecCont = document.getElementById('detalle-ingredientes-container');
    // Find which section this product belongs to
    const secciones = window.SECCIONES_CATALOGO || [];
    let seccionProducto = null;
    secciones.forEach(sec => {
        const prods = (sec.productos || []).map(p => String(p));
        if (prods.includes(d.productoId)) seccionProducto = sec;
    });
    if (seccionProducto && seccionProducto.listas_ingredientes && seccionProducto.listas_ingredientes.length > 0) {
        detalleState.listasSeccion = JSON.parse(JSON.stringify(seccionProducto.listas_ingredientes));
        detalleState.listasSeccionQuitados = {}; // {listaNombre: [ingrediente, ...]}
        seccionProducto.listas_ingredientes.forEach(lista => {
            if (!lista.ingredientes || !lista.ingredientes.length) return;
            const listaDiv = document.createElement('div');
            listaDiv.className = 'detalle-lista-seccion';
            listaDiv.style.cssText = 'margin-bottom:12px;';
            const label = document.createElement('span');
            label.className = 'detalle-opcion-label';
            label.textContent = lista.nombre || 'Ingredientes';
            listaDiv.appendChild(label);
            const ingList = document.createElement('div');
            ingList.className = 'detalle-ingredientes-lista';
            lista.ingredientes.forEach(ing => {
                const ingNombre = ing.trim();
                if (!ingNombre) return;
                const lbl = document.createElement('label');
                lbl.className = 'detalle-ingrediente-item';
                lbl.innerHTML = `<input type="checkbox" checked data-lista="${escapeHTML(lista.nombre)}" data-ingrediente="${escapeHTML(ingNombre)}"><span class="check-icon"></span><span>${escapeHTML(ingNombre)}</span>`;
                const cb = lbl.querySelector('input');
                cb.addEventListener('change', function() {
                    lbl.classList.toggle('unchecked', !this.checked);
                    const listaNom = this.dataset.lista;
                    const ingNom = this.dataset.listaIngrediente || ingNombre;
                    if (!detalleState.listasSeccionQuitados[listaNom]) detalleState.listasSeccionQuitados[listaNom] = [];
                    if (!this.checked) {
                        if (!detalleState.listasSeccionQuitados[listaNom].includes(ingNombre)) {
                            detalleState.listasSeccionQuitados[listaNom].push(ingNombre);
                        }
                    } else {
                        detalleState.listasSeccionQuitados[listaNom] = detalleState.listasSeccionQuitados[listaNom].filter(i => i !== ingNombre);
                    }
                });
                ingList.appendChild(lbl);
            });
            listaDiv.appendChild(ingList);
            ingCont.appendChild(listaDiv);
            hasIngredientes = true;
        });
    }

    // Secciones custom
    const secCont = document.getElementById('detalle-secciones-custom-container');
    secCont.innerHTML='';
    // Resetear secciones en el estado
    detalleState.secciones = {};
    detalleState.seccionesPrecios = {};
    let secs = []; try { secs = JSON.parse(d.secciones||'[]'); } catch(e){}
    let hasSecciones = false;
    secs.forEach(sec => {
        if(!sec.nombre || !sec.items?.length) return;
        hasSecciones = true;
        const secNombre = sec.nombre;
        const esMultiple = sec.cantidad_obligatoria === 0 || sec.cantidad_obligatoria > 1; // permitir multiples si no es obligatoria 1
        const div = document.createElement('div'); div.className='detalle-seccion'; div.style.marginBottom='16px';
        div.innerHTML=`<span class="detalle-opcion-label">${escapeHTML(secNombre)} ${sec.cantidad_obligatoria>0?`<span style="color:#e74c3c">(x${sec.cantidad_obligatoria})</span>`:''}</span>`;
        const chipsDiv = document.createElement('div'); chipsDiv.className='detalle-chips';
        sec.items.forEach(opt => {
            const b = document.createElement('button'); b.className='detalle-opcion-btn'; b.textContent = `${escapeHTML(opt.nombre)}${opt.precio>0?` +$${opt.precio.toFixed(2)}`:''}`;
            b.dataset.secNombre = secNombre;
            b.dataset.optNombre = opt.nombre;
            b.dataset.optPrecio = opt.precio || 0;
            b.onclick = () => {
                b.classList.toggle('seleccionado');
                // Reconstruir secciones desde los botones seleccionados
                detalleState.secciones = {};
                detalleState.seccionesPrecios = {};
                document.querySelectorAll('#detalle-secciones-custom-container .detalle-opcion-btn.seleccionado').forEach(sel => {
                    const sNombre = sel.dataset.secNombre;
                    const oNombre = sel.dataset.optNombre;
                    const oPrecio = parseFloat(sel.dataset.optPrecio) || 0;
                    if(!detalleState.secciones[sNombre]) detalleState.secciones[sNombre] = [];
                    detalleState.secciones[sNombre].push(oNombre);
                    if(oPrecio > 0) {
                        const key = sNombre + '|' + oNombre;
                        detalleState.seccionesPrecios[key] = oPrecio;
                    }
                });
                actualizarDetalleTotal();
            };
            chipsDiv.appendChild(b);
        });
        div.appendChild(chipsDiv);
        secCont.appendChild(div);
    });
    secCont.style.display = hasSecciones ? '' : 'none';

    // Recomendados
    const recCont = document.getElementById('detalle-recomendados');
    const recContWrapper = document.getElementById('detalle-recomendados-container');
    const recHint = recContWrapper ? recContWrapper.querySelector('.detalle-recomendados-hint') : null;
    recCont.innerHTML='';
    let recIds = (d.recomendados||'').split(',').filter(v=>v.trim());
    let hasRecomendados = false;
    // Si el detalle fue abierto desde cascada, NO mostrar recomendados (evitar loop infinito)
    if(detalleEsCascada) {
        if(recContWrapper) recContWrapper.style.display = 'none';
    } else if(recIds.length && document.querySelectorAll('.cat-product-card').length) {
        recIds.forEach(rid => {
            const prodCard = document.querySelector(`.cat-product-card[data-producto-id="${rid}"]`);
            if(!prodCard || prodCard.dataset.stock === 'false') return;
            hasRecomendados = true;
            const card = document.createElement('div'); card.className='detalle-recomendado-card';
            card.dataset.recomendadoId = rid;
            const imgSrc = prodCard.dataset.imagenPrincipal || (prodCard.dataset.imagenes ? prodCard.dataset.imagenes.split(',')[0] : '');
            const imgHtml = imgSrc ? `<img src="${escapeHTML(imgSrc)}" class="detalle-recomendado-img" alt="" loading="lazy">` : '';
            card.innerHTML = `${imgHtml}<div class="detalle-recomendado-info"><span class="detalle-recomendado-nombre">${escapeHTML(prodCard.dataset.nombre)}</span><span class="detalle-recomendado-precio">$${parseFloat(prodCard.dataset.precio).toFixed(2)}</span></div><span class="detalle-recomendado-orden" style="display:none;"></span>`;
            card.onclick = () => {
                card.classList.toggle('recomendado-seleccionado');
                if(card.classList.contains('recomendado-seleccionado')) {
                    colaRecomendados.push(prodCard);
                } else {
                    const idx = colaRecomendados.findIndex(c => c.dataset.productoId === rid);
                    if(idx > -1) colaRecomendados.splice(idx, 1);
                }
                actualizarOrdenRecomendados();
                actualizarDetalleTotal();
            };
            recCont.appendChild(card);
        });
        if(recHint) recHint.textContent = 'Toca para personalizar';
    }
    if(!detalleEsCascada && recContWrapper) recContWrapper.style.display = hasRecomendados ? '' : 'none';
}

function actualizarIndicadorCarritoDetalle() {
    const indicador = document.getElementById('detalle-ya-en-carrito');
    if(!indicador) return;
    if(detalleState.yaEnCarrito > 0) {
        indicador.textContent = `Ya tenés ${detalleState.yaEnCarrito} en el carrito`;
        indicador.style.display = 'block';
    } else {
        indicador.style.display = 'none';
    }
}

function actualizarOrdenRecomendados() {
    const recContWrapper = document.getElementById('detalle-recomendados-container');
    const hint = recContWrapper ? recContWrapper.querySelector('.detalle-recomendados-hint') : null;
    const cards = document.querySelectorAll('#detalle-recomendados .detalle-recomendado-card');
    cards.forEach(card => {
        const prodId = card.dataset.recomendadoId;
        const idx = colaRecomendados.findIndex(c => c.dataset.productoId === prodId);
        const badge = card.querySelector('.detalle-recomendado-orden');
        if(idx > -1 && badge) { badge.textContent = idx + 1; badge.style.display = 'flex'; }
        else if(badge) { badge.style.display = 'none'; }
    });
    if(hint) {
        if(colaRecomendados.length > 0) {
            hint.textContent = `${colaRecomendados.length} producto${colaRecomendados.length > 1 ? 's' : ''} seleccionado${colaRecomendados.length > 1 ? 's' : ''}`;
        } else {
            hint.textContent = 'Toca para personalizar';
        }
    }
}

function procesarColaRecomendados() {
    if(colaRecomendados.length === 0) {
        detalleEsCascada = false;
        return;
    }
    const nextCard = colaRecomendados.shift();
    // Saltar productos sin stock
    if(nextCard.dataset.stock === 'false') {
        procesarColaRecomendados();
        return;
    }
    setTimeout(() => abrirDetalleProducto(nextCard, true), 350);
}

function actualizarDetalleTotal() {
    let precio = detalleState.precio + detalleState.agregados.reduce((s,a)=>s+a.precio, 0);
    // Sumar precios de secciones custom desde el estado (no parseando texto)
    for(const key in detalleState.seccionesPrecios) {
        precio += detalleState.seccionesPrecios[key];
    }
    const totalEl = document.getElementById('detalle-precio-total');
    if(totalEl) totalEl.textContent = detalleState.cant>0 ? `Total: $${(precio*detalleState.cant).toFixed(2)}` : '';
    // Actualizar texto del boton (mostrar cantidad de recomendados en cola)
    const btnAgregar = document.getElementById('detalle-btn-agregar');
    if(btnAgregar) {
        let textoBase = detalleState.cant > 1 ? `Agregar ${detalleState.cant} al carrito` : 'Agregar al carrito';
        if(colaRecomendados.length > 0 && !detalleEsCascada) {
            textoBase += ` (y ${colaRecomendados.length} más)`;
        }
        btnAgregar.textContent = textoBase;
    }
}

function detalleAgregarAlCarrito() {
    if(detalleState.cant <= 0) return;
    for(let i=0; i<detalleState.cant; i++) {
        carrito.push({
            productoId: detalleState.productoId,
            nombre: detalleState.nombre,
            precio: detalleState.precio,
            agregados: [...detalleState.agregados],
            secciones: JSON.parse(JSON.stringify(detalleState.secciones)),
            seccionesPrecios: Object.assign({}, detalleState.seccionesPrecios),
            ingredientes: [...detalleState.ingredientes],
            ingredientesQuitados: [...detalleState.ingredientesQuitados],
            listasSeccion: JSON.parse(JSON.stringify(detalleState.listasSeccion || [])),
            listasSeccionQuitados: JSON.parse(JSON.stringify(detalleState.listasSeccionQuitados || {})),
            talle: detalleState.talle,
            color: detalleState.color
        });
    }
    recalcularCarrito();
    cerrarModal('modal-detalle-producto');
    const b = document.querySelector('.carrito-flotante'); if(b) { b.classList.remove('animacion-carrito'); void b.offsetWidth; b.classList.add('animacion-carrito'); }
    let toast = document.querySelector('.toast-confirmacion'); if(!toast){ toast=document.createElement('div'); toast.className='toast-confirmacion'; document.body.appendChild(toast); }
    toast.textContent = 'Agregado al carrito'; toast.style.opacity='1'; toast.style.transform='translateX(-50%) translateY(0)';
    setTimeout(()=>{ toast.style.opacity='0'; toast.style.transform='translateX(-50%) translateY(20px)'; }, 1500);
    // Procesar cola de recomendados en cascada
    procesarColaRecomendados();
}

// ============================================
// PRODUCTOS - NUEVO / EDITAR
// ============================================
function abrirModalNuevoProducto() { abrirModal('modal-producto'); }

function abrirEditarProducto(btn) {
    const d = btn.dataset;
    document.getElementById('form-editar-prod').action = `/editar-producto/${d.id}`;
    document.getElementById('edit-nombre').value = d.nombre || '';
    document.getElementById('edit-precio').value = d.precio || '';
    document.getElementById('edit-categoria').value = d.categoria || 'Sin Categoria';
    document.getElementById('edit-stock').checked = d.stock === 'true';

    // Cargar datos de descuento
    const editDescActivo = document.getElementById('edit-descuento-activo');
    const editDescFields = document.getElementById('edit-descuento-fields');
    const editTipoPorc = document.getElementById('edit-tipo-porcentaje');
    const editTipoMonto = document.getElementById('edit-tipo-monto');
    const editValorDesc = document.getElementById('edit-valor-descuento');
    if(editDescActivo && editDescFields) {
        const tieneDesc = d.descuentoActivo === 'true';
        editDescActivo.checked = tieneDesc;
        editDescFields.style.display = tieneDesc ? 'block' : 'none';
        if(tieneDesc) {
            const tipo = d.tipoDescuento || 'porcentaje';
            if(editTipoPorc) editTipoPorc.checked = tipo === 'porcentaje';
            if(editTipoMonto) editTipoMonto.checked = tipo === 'monto';
            if(editValorDesc) editValorDesc.value = d.valorDescuento || '';
            calcularPreviewDescuento('edit');
        } else {
            if(editValorDesc) editValorDesc.value = '';
            const preview = document.getElementById('edit-descuento-preview');
            if(preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
        }
    }

    if(window.RUBRO_NEGOCIO === 'ropa') {
        const editTalles = document.getElementById('edit-talles'); if(editTalles) editTalles.value = d.talles || '';
        const editColores = document.getElementById('edit-colores'); if(editColores) editColores.value = d.colores || '';
        const editMaterial = document.getElementById('edit-material'); if(editMaterial) editMaterial.value = d.material || '';
        const editGenero = document.getElementById('edit-genero'); if(editGenero) editGenero.value = d.genero || '';
    }
    if(window.RUBRO_NEGOCIO === 'restaurante') {
        const editDesc = document.getElementById('edit-descripcion'); if(editDesc) editDesc.value = d.descripcion || '';
        // Marcar agregados
        let agrIds = (d.agregadosIds||'').split(',');
        document.querySelectorAll('#edit-agregados-checkboxes input[name="agregados_ids"]').forEach(cb => {
            cb.checked = agrIds.includes(cb.value);
        });
        // Secciones
        try {
            const secciones = JSON.parse(d.secciones || '[]');
            const container = document.getElementById('edit-secciones-container');
            if(container) {
                container.innerHTML = '';
                secciones.forEach(sec => agregarSeccionEdit(sec));
            }
            const jsonInput = document.getElementById('edit-secciones-json');
            if(jsonInput) jsonInput.value = JSON.stringify(secciones);
        } catch(e) {}
        // Ingredientes (marcar checkboxes por IDs)
        let ingIds = (d.ingredientesIds||'').split(',');
        document.querySelectorAll('#edit-ingredientes-checkboxes input[name="ingredientes_ids"]').forEach(cb => {
            cb.checked = ingIds.includes(cb.value);
        });
        // Recomendados
        let recIds = (d.recomendados||'').split(',');
        document.querySelectorAll('#form-editar-prod input[name="productos_recomendados"]').forEach(cb => {
            cb.checked = recIds.includes(cb.value);
        });
    }

    // Cargar imagenes existentes en la galeria de edicion
    if(galeriaEditInstance) {
        let imagenes = [];
        if(d.imagenes) {
            imagenes = d.imagenes.split(',').filter(u => u.trim());
        }
        if(!imagenes.length && d.imagenPrincipal) {
            imagenes = [d.imagenPrincipal];
        }
        galeriaEditInstance.cargarExistentes(imagenes);
    }

    const linkEliminar = document.getElementById('link-eliminar-prod');
    if(linkEliminar) linkEliminar.href = `/eliminar-producto/${d.id}`;

    abrirModal('modal-editar-prod');
}

// ============================================
// GALERIA TINDER (Upload de fotos)
// ============================================
let galeriaNuevoInstance = null;
let galeriaEditInstance = null;

class GaleriaTinder {
    constructor(containerId, fileInputId, ordenInputId, carpeta) {
        this.container = document.getElementById(containerId);
        this.fileInput = document.getElementById(fileInputId);
        this.ordenInput = document.getElementById(ordenInputId);
        this.carpeta = carpeta || 'nortfood/productos';
        this.fotos = [];       // URLs (Cloudinary http o data: temporal)
        this.files = [];       // File objects para submit (solo las nuevas)
        this.existingUrls = []; // URLs existentes del servidor
        this.uploading = false; // Flag: hay uploads a Cloudinary en progreso
        this.pendingUploads = 0; // Contador de uploads pendientes
        if(!this.container || !this.fileInput) return;
        this.init();
    }
    init() {
        const addBtn = document.createElement('div');
        addBtn.className = 'caja-agregar';
        addBtn.textContent = '+';
        addBtn.setAttribute('role', 'button');
        addBtn.setAttribute('tabindex', '0');
        const openPicker = (e) => {
            if(e) { e.preventDefault(); e.stopPropagation(); }
            if(this.uploading) return; // No abrir picker mientras sube
            // Reset value to ensure change fires even if same file selected
            this.fileInput.value = '';
            this.fileInput.click();
        };
        addBtn.addEventListener('click', openPicker);
        addBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            openPicker(e);
        });
        this.container.appendChild(addBtn);
        this.fileInput.addEventListener('change', (e) => {
            Array.from(e.target.files).forEach(file => {
                this._subirACloudinary(file);
            });
        });
    }
    // Subir imagen a Cloudinary directamente desde el navegador
    async _subirACloudinary(file) {
        const cloudName = window.CLOUDINARY_CLOUD_NAME;
        const uploadPreset = window.CLOUDINARY_UPLOAD_PRESET;

        // Si no hay config de Cloudinary, usar el metodo viejo (data: URL + file al backend)
        if(!cloudName || cloudName === 'tu_cloud_name_aqui') {
            const reader = new FileReader();
            reader.onload = (ev) => {
                this.agregarFoto(ev.target.result, file);
            };
            reader.readAsDataURL(file);
            return;
        }

        // Mostrar preview temporal mientras sube
        const previewUrl = URL.createObjectURL(file);
        const idx = this.fotos.length;
        this.fotos.push(previewUrl);
        this.files.push(file); // temporal

        const caja = this._crearCajaFoto(previewUrl, idx);
        // Indicador de subida
        const uploadIndicator = document.createElement('div');
        uploadIndicator.className = 'upload-indicator';
        uploadIndicator.innerHTML = '<div class="upload-spinner"></div><span>Subiendo...</span>';
        caja.appendChild(uploadIndicator);

        const addBtn = this.container.querySelector('.caja-agregar');
        this.container.insertBefore(caja, addBtn);
        this.sincronizarOrden();

        // Subir a Cloudinary via API
        this.uploading = true;
        this.pendingUploads++;
        const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', uploadPreset);
        formData.append('folder', this.carpeta);

        try {
            const response = await fetch(cloudinaryUrl, { method: 'POST', body: formData });
            if(!response.ok) throw new Error('Upload failed');
            const result = await response.json();
            const secureUrl = result.secure_url;

            // Exito: reemplazar preview con URL de Cloudinary
            this.fotos[idx] = secureUrl;
            this.files[idx] = null; // Ya no es file nuevo, es URL existente
            const img = caja.querySelector('img');
            if(img) img.src = secureUrl;
            uploadIndicator.innerHTML = '<span style="color:#27ae60;font-size:11px;font-weight:bold;">OK</span>';
            setTimeout(() => uploadIndicator.remove(), 1200);
        } catch(error) {
            console.error('[Cloudinary] Error al subir:', error);
            uploadIndicator.innerHTML = '<span style="color:#e74c3c;font-size:11px;">Error</span>';
            // Revertir: permitir que el backend lo maneje como file
            this.fotos[idx] = previewUrl;
            this.files[idx] = file;
        } finally {
            this.pendingUploads--;
            if(this.pendingUploads <= 0) {
                this.uploading = false;
                this.pendingUploads = 0;
            }
            this.sincronizarOrden();
        }
    }
    _crearCajaFoto(src, idx) {
        const caja = document.createElement('div');
        caja.className = 'caja-foto';
        caja.draggable = true;
        caja.dataset.idx = idx;
        caja.innerHTML = `<img src="${src}" alt="Foto"><button type="button" class="btn-borrar-foto">×</button>`;
        caja.querySelector('.btn-borrar-foto').onclick = (e) => { e.stopPropagation(); this.eliminarFoto(parseInt(caja.dataset.idx)); };
        caja.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(caja.dataset.idx)); caja.style.opacity='0.5'; });
        caja.addEventListener('dragend', () => { caja.style.opacity='1'; });
        caja.addEventListener('dragover', (e) => { e.preventDefault(); caja.style.border='2px solid var(--color-principal)'; });
        caja.addEventListener('dragleave', () => { caja.style.border=''; });
        caja.addEventListener('drop', (e) => { e.preventDefault(); caja.style.border=''; const from = parseInt(e.dataTransfer.getData('text/plain')); if(!isNaN(from)) this.reordenar(from, parseInt(caja.dataset.idx)); });
        return caja;
    }
    // Cargar imagenes existentes del servidor
    cargarExistentes(urls) {
        this.limpiar();
        this.existingUrls = [];
        if(!urls || !urls.length) return;
        urls.forEach(url => {
            if(!url || !url.trim()) return;
            url = url.trim();
            this.existingUrls.push(url);
            this.agregarFoto(url, null); // null = no es file nuevo
        });
    }
    // Limpiar todo
    limpiar() {
        this.fotos = [];
        this.files = [];
        this.existingUrls = [];
        const addBtn = this.container.querySelector('.caja-agregar');
        this.container.querySelectorAll('.caja-foto').forEach(c => c.remove());
        this.sincronizarOrden();
    }
    agregarFoto(src, fileObj) {
        const idx = this.fotos.length;
        this.fotos.push(src);
        this.files.push(fileObj); // null para URLs existentes, File para nuevas
        const caja = document.createElement('div');
        caja.className = 'caja-foto';
        caja.draggable = true;
        caja.innerHTML = `<img src="${src}" alt="Foto"><button type="button" class="btn-borrar-foto">&times;</button>`;
        caja.querySelector('.btn-borrar-foto').onclick = (e) => { e.stopPropagation(); this.eliminarFoto(idx); };
        caja.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(idx)); caja.style.opacity='0.5'; });
        caja.addEventListener('dragend', () => { caja.style.opacity='1'; });
        caja.addEventListener('dragover', (e) => { e.preventDefault(); caja.style.border='2px solid var(--color-principal)'; });
        caja.addEventListener('dragleave', () => { caja.style.border=''; });
        caja.addEventListener('drop', (e) => { e.preventDefault(); caja.style.border=''; const from = parseInt(e.dataTransfer.getData('text/plain')); if(!isNaN(from)) this.reordenar(from, idx); });
        const addBtn = this.container.querySelector('.caja-agregar');
        this.container.insertBefore(caja, addBtn);
        this.sincronizarOrden();
    }
    eliminarFoto(idx) {
        this.fotos.splice(idx, 1);
        this.files.splice(idx, 1);
        this.rebuild();
    }
    reordenar(from, to) {
        const [fotoItem] = this.fotos.splice(from, 1);
        const [fileItem] = this.files.splice(from, 1);
        this.fotos.splice(to, 0, fotoItem);
        this.files.splice(to, 0, fileItem);
        this.rebuild();
    }
    rebuild() {
        const addBtn = this.container.querySelector('.caja-agregar');
        this.container.querySelectorAll('.caja-foto').forEach(c => c.remove());
        this.fotos.forEach((src, idx) => {
            const caja = document.createElement('div');
            caja.className = 'caja-foto';
            caja.draggable = true;
            caja.innerHTML = `<img src="${src}" alt="Foto"><button type="button" class="btn-borrar-foto">&times;</button>`;
            caja.querySelector('.btn-borrar-foto').onclick = (e) => { e.stopPropagation(); this.eliminarFoto(idx); };
            caja.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(idx)); caja.style.opacity='0.5'; });
            caja.addEventListener('dragend', () => { caja.style.opacity='1'; });
            caja.addEventListener('dragover', (e) => { e.preventDefault(); caja.style.border='2px solid var(--color-principal)'; });
            caja.addEventListener('dragleave', () => { caja.style.border=''; });
            caja.addEventListener('drop', (e) => { e.preventDefault(); caja.style.border=''; const from = parseInt(e.dataTransfer.getData('text/plain')); if(!isNaN(from)) this.reordenar(from, idx); });
            this.container.insertBefore(caja, addBtn);
        });
        this.sincronizarOrden();
    }
    sincronizarOrden() {
        // Generar formato que el backend espera: [{tipo: "existente", url: "..."}, {tipo: "nueva", indice: N}]
        const orden = [];
        let nuevoIdx = 0;
        this.fotos.forEach((src, idx) => {
            const file = this.files[idx];
            if(src && src.startsWith('http')) {
                // URL ya en Cloudinary (existente o recien subida desde el navegador)
                orden.push({ tipo: 'existente', url: src });
            } else if(file !== null && file !== undefined) {
                // Archivo nuevo que el backend debe subir
                orden.push({ tipo: 'nueva', indice: nuevoIdx });
                nuevoIdx++;
            }
        });
        if(this.ordenInput) this.ordenInput.value = JSON.stringify(orden);
    }
    // Construir FormData con los archivos nuevos incluidos (metodo confiable)
    prepararFormData(formElement) {
        this.sincronizarOrden();
        const formData = new FormData(formElement);
        // Remover el campo 'fotos' vacio que viene del input file original
        formData.delete('fotos');
        // Remover orden_imagenes viejo y reemplazar con el formato correcto
        formData.delete('orden_imagenes');
        // Agregar los archivos nuevos al FormData
        const newFiles = this.files.filter(f => f !== null && f !== undefined);
        newFiles.forEach(f => {
            formData.append('fotos', f);
        });
        // Re-agregar orden_imagenes con el formato {tipo, url/indice}
        if(this.ordenInput && this.ordenInput.value) {
            formData.append('orden_imagenes', this.ordenInput.value);
        }
        return formData;
    }
    // Poner los File objects nuevos en el input antes de submit (fallback legacy)
    prepararSubmit() {
        this.sincronizarOrden();
        const newFiles = this.files.filter(f => f !== null);
        if(newFiles.length) {
            try {
                if(typeof DataTransfer !== 'undefined') {
                    const dt = new DataTransfer();
                    newFiles.forEach(f => dt.items.add(f));
                    this.fileInput.files = dt.files;
                }
            } catch(e) {
                console.warn('DataTransfer no soportado, las imagenes nuevas podrian no guardarse', e);
            }
        }
        return true;
    }
    // Helper: crear caja de foto reutilizable
    _crearCajaFoto(src, idx) {
        const caja = document.createElement('div');
        caja.className = 'caja-foto';
        caja.draggable = true;
        caja.dataset.idx = idx;
        caja.innerHTML = '<img src="' + src + '" alt="Foto"><button type="button" class="btn-borrar-foto">&times;</button>';
        caja.querySelector('.btn-borrar-foto').onclick = (e) => { e.stopPropagation(); this.eliminarFoto(parseInt(caja.dataset.idx)); };
        caja.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(caja.dataset.idx)); caja.style.opacity='0.5'; });
        caja.addEventListener('dragend', () => { caja.style.opacity='1'; });
        caja.addEventListener('dragover', (e) => { e.preventDefault(); caja.style.border='2px solid var(--color-principal)'; });
        caja.addEventListener('dragleave', () => { caja.style.border=''; });
        caja.addEventListener('drop', (e) => { e.preventDefault(); caja.style.border=''; const from = parseInt(e.dataTransfer.getData('text/plain')); if(!isNaN(from)) this.reordenar(from, parseInt(caja.dataset.idx)); });
        return caja;
    }
}

// ============================================
// SECCIONES DE OPCIONES (Restaurante)
// ============================================
let seccionesNuevo = [];
let seccionesEdit = [];

function agregarSeccionNuevo(data) {
    data = data || { nombre: '', items: [], cantidad_obligatoria: 0 };
    const idx = seccionesNuevo.length;
    seccionesNuevo.push(data);
    renderSeccion('nuevo', idx, data);
    sincronizarSecciones('nuevo');
}
function agregarSeccionEdit(data) {
    data = data || { nombre: '', items: [], cantidad_obligatoria: 0 };
    const idx = seccionesEdit.length;
    seccionesEdit.push(data);
    renderSeccion('edit', idx, data);
    sincronizarSecciones('edit');
}

function renderSeccion(prefix, idx, data) {
    const container = document.getElementById(prefix + '-secciones-container');
    if(!container) return;
    const div = document.createElement('div');
    div.className = 'seccion-item';
    div.dataset.idx = idx;
    div.innerHTML = `
        <div class="seccion-item-header" style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
            <input type="text" placeholder="Nombre seccion (Ej: Bebida)" value="${escapeHTML(data.nombre||'')}" style="flex:1; padding:10px; border:1.5px solid #ddd; border-radius:10px; outline:none;" onchange="secciones${prefix==='nuevo'?'Nuevo':'Edit'}[${idx}].nombre=this.value; sincronizarSecciones('${prefix}')">
            <input type="number" placeholder="Obligat." min="0" value="${data.cantidad_obligatoria||0}" style="width:65px; padding:10px; border:1.5px solid #ddd; border-radius:10px; outline:none;" onchange="secciones${prefix==='nuevo'?'Nuevo':'Edit'}[${idx}].cantidad_obligatoria=parseInt(this.value)||0; sincronizarSecciones('${prefix}')">
            <button type="button" onclick="this.closest('.seccion-item').remove(); secciones${prefix==='nuevo'?'Nuevo':'Edit'}.splice(${idx},1); rebuildSecciones('${prefix}'); sincronizarSecciones('${prefix}')" style="background:#e74c3c; color:white; border:none; border-radius:8px; padding:8px; cursor:pointer; font-weight:bold;">X</button>
        </div>
        <div class="seccion-items-container" data-seccion-idx="${idx}"></div>
        <div class="seccion-item-row" style="margin-top:6px;">
            <input type="text" placeholder="Opcion" style="padding:8px; border:1px solid #ddd; border-radius:8px; outline:none; flex:1;">
            <input type="number" placeholder="Precio" step="0.01" value="0" style="padding:8px; border:1px solid #ddd; border-radius:8px; outline:none; width:70px;">
            <button type="button" onclick="agregarItemSeccion('${prefix}', ${idx}, this)" style="background:var(--color-principal); color:white; border:none; border-radius:8px; padding:8px 12px; cursor:pointer; font-weight:700;">+</button>
        </div>
    `;
    // Render items existentes
    const itemsContainer = div.querySelector('.seccion-items-container');
    (data.items || []).forEach((item, itemIdx) => {
        agregarItemDOM(itemsContainer, prefix, idx, itemIdx, item);
    });
    container.appendChild(div);
}

function agregarItemSeccion(prefix, secIdx, btn) {
    const row = btn.parentElement;
    const inputs = row.querySelectorAll('input');
    const nombre = inputs[0].value.trim();
    const precio = parseFloat(inputs[1].value) || 0;
    if(!nombre) return;
    const secciones = prefix === 'nuevo' ? seccionesNuevo : seccionesEdit;
    if(!secciones[secIdx].items) secciones[secIdx].items = [];
    const itemIdx = secciones[secIdx].items.length;
    secciones[secIdx].items.push({ nombre, precio });
    const itemsContainer = btn.closest('.seccion-item').querySelector('.seccion-items-container');
    agregarItemDOM(itemsContainer, prefix, secIdx, itemIdx, { nombre, precio });
    inputs[0].value = '';
    inputs[1].value = '0';
    sincronizarSecciones(prefix);
}

function agregarItemDOM(container, prefix, secIdx, itemIdx, item) {
    const div = document.createElement('div');
    div.className = 'seccion-item-row';
    div.innerHTML = `
        <span style="flex:1; font-size:13px;">${escapeHTML(item.nombre)}</span>
        <span style="font-size:13px; color:var(--color-principal); font-weight:700;">${item.precio > 0 ? '+$' + item.precio.toFixed(2) : 'Gratis'}</span>
        <button type="button" onclick="secciones${prefix==='nuevo'?'Nuevo':'Edit'}[${secIdx}].items.splice(${itemIdx},1); rebuildSecciones('${prefix}'); sincronizarSecciones('${prefix}')" style="background:#ffebea; color:#e74c3c; border:none; border-radius:6px; padding:4px 8px; cursor:pointer; font-weight:bold; font-size:12px;">X</button>
    `;
    container.appendChild(div);
}

function rebuildSecciones(prefix) {
    const container = document.getElementById(prefix + '-secciones-container');
    if(!container) return;
    container.innerHTML = '';
    const secciones = prefix === 'nuevo' ? seccionesNuevo : seccionesEdit;
    secciones.forEach((sec, idx) => renderSeccion(prefix, idx, sec));
}

function sincronizarSecciones(prefix) {
    const input = document.getElementById(prefix + '-secciones-json');
    const secciones = prefix === 'nuevo' ? seccionesNuevo : seccionesEdit;
    if(input) input.value = JSON.stringify(secciones);
}

function beforeSubmitSecciones(prefix) {
    sincronizarSecciones(prefix);
    return true;
}

// ============================================
// FILTRAR AGREGADOS POR CATEGORIA
// ============================================
function filtrarAgregadosPorCat(prefix, cat, el) {
    const tabContainer = el.parentElement;
    tabContainer.querySelectorAll('.agregados-cat-tab').forEach(t => t.classList.remove('activo'));
    el.classList.add('activo');
    const container = document.getElementById(prefix + '-agregados-checkboxes');
    if(!container) return;
    container.querySelectorAll('.agregado-check-item').forEach(item => {
        if(cat === 'todas' || item.dataset.categoria === cat) item.style.display = '';
        else item.style.display = 'none';
    });
}

// Filtrar ingredientes por categoria (mismo patron que agregados)
function filtrarIngredientesPorCat(prefix, cat, el) {
    const tabContainer = el.parentElement;
    tabContainer.querySelectorAll('.agregados-cat-tab').forEach(t => t.classList.remove('activo'));
    el.classList.add('activo');
    const container = document.getElementById(prefix + '-ingredientes-checkboxes');
    if(!container) return;
    container.querySelectorAll('.agregado-check-item').forEach(item => {
        if(cat === 'todas' || item.dataset.categoria === cat) item.style.display = '';
        else item.style.display = 'none';
    });
}

// ============================================
// EDITAR AGREGADO
// ============================================
function abrirEditarAgregado(data) {
    if(data && data.dataset) data = data.dataset;
    const form = document.getElementById('form-editar-agregado');
    if(!form) return;
    form.action = `/editar-agregado/${data.id}`;
    document.getElementById('edit-agregado-nombre').value = data.nombre || '';
    document.getElementById('edit-agregado-precio').value = data.precio || '';
    document.getElementById('edit-agregado-categoria').value = data.categoria || '';
    const imgPreview = document.getElementById('edit-agregado-foto-preview');
    const imgEl = document.getElementById('edit-agregado-foto-img');
    if(data.imagen && imgPreview && imgEl) {
        imgEl.src = data.imagen;
        imgPreview.style.display = 'block';
    } else if(imgPreview) {
        imgPreview.style.display = 'none';
    }
    abrirModal('modal-editar-agregado');
}

// ============================================
// EDITAR INGREDIENTE
// ============================================
function abrirEditarIngrediente(data) {
    if(data && data.dataset) data = data.dataset;
    const form = document.getElementById('form-editar-ingrediente');
    if(!form) return;
    form.action = `/editar-ingrediente/${data.id}`;
    document.getElementById('edit-ingrediente-nombre').value = data.nombre || '';
    document.getElementById('edit-ingrediente-categoria').value = data.categoria || '';
    const imgPreview = document.getElementById('edit-ingrediente-foto-preview');
    const imgEl = document.getElementById('edit-ingrediente-foto-img');
    const eliminarCheck = document.getElementById('edit-ingrediente-eliminar-foto');
    if(eliminarCheck) eliminarCheck.checked = false;
    if(data.imagen && imgPreview && imgEl) {
        imgEl.src = data.imagen;
        imgPreview.style.display = 'block';
    } else if(imgPreview) {
        imgPreview.style.display = 'none';
    }
    abrirModal('modal-editar-ingrediente');
}

// ============================================
// MENU DESPLEGABLE PROPIETARIO
// ============================================
function toggleMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('dropdown-menu');
    if(menu) menu.classList.toggle('show');
}
document.addEventListener('click', () => {
    const menu = document.getElementById('dropdown-menu');
    if(menu) menu.classList.remove('show');
});

// ============================================
// HORARIOS - CONTROLES
// ============================================
function toggleDia(dia) {
    const check = document.getElementById('dia_' + dia);
    const cont = document.getElementById('contenedor_horas_' + dia);
    const cerrado = document.getElementById('cerrado_dia_' + dia);
    if(check && cont) cont.style.display = check.checked ? 'flex' : 'none';
    if(cerrado) cerrado.style.display = check.checked ? 'none' : 'block';
}
function toggleTurno2(dia) {
    const check = document.getElementById('dia_' + dia + '_turno2');
    const cont = document.getElementById('horas_dia_' + dia + '_turno2');
    if(check && cont) cont.style.display = check.checked ? 'flex' : 'none';
}
function copiarLunesATodos() {
    const lunesAbierto = document.getElementById('dia_1');
    const lunesApertura = document.querySelector('input[name="dia_1_apertura"]');
    const lunesCierre = document.querySelector('input[name="dia_1_cierre"]');
    const lunesTurno2 = document.getElementById('dia_1_turno2');
    const lunesApertura2 = document.querySelector('input[name="dia_1_apertura2"]');
    const lunesCierre2 = document.querySelector('input[name="dia_1_cierre2"]');
    if(!lunesAbierto) return;
    for(let i = 2; i <= 7; i++) {
        const check = document.getElementById('dia_' + i);
        if(check) { check.checked = lunesAbierto.checked; toggleDia(i.toString()); }
        const apertura = document.querySelector(`input[name="dia_${i}_apertura"]`);
        const cierre = document.querySelector(`input[name="dia_${i}_cierre"]`);
        if(apertura && lunesApertura) apertura.value = lunesApertura.value;
        if(cierre && lunesCierre) cierre.value = lunesCierre.value;
        const turno2 = document.getElementById('dia_' + i + '_turno2');
        if(turno2 && lunesTurno2) { turno2.checked = lunesTurno2.checked; toggleTurno2(i.toString()); }
        const apertura2 = document.querySelector(`input[name="dia_${i}_apertura2"]`);
        const cierre2 = document.querySelector(`input[name="dia_${i}_cierre2"]`);
        if(apertura2 && lunesApertura2) apertura2.value = lunesApertura2.value;
        if(cierre2 && lunesCierre2) cierre2.value = lunesCierre2.value;
    }
}

// ============================================
// CONFIG - LOGO CIRCULO
// ============================================
function toggleColorCirculo() {
    const sw = document.getElementById('switch-logo-circulo');
    const cont = document.getElementById('color-circulo-container');
    if(cont && sw) cont.style.display = sw.checked ? 'block' : 'none';
}

function toggleAliasBancario() {
    const sw = document.getElementById('switch-transferencia');
    const cont = document.getElementById('alias-bancario-container');
    if(cont && sw) cont.style.display = sw.checked ? 'block' : 'none';
}

function toggleTiempoEntrega() {
    const sw = document.getElementById('switch-delivery');
    const cont = document.getElementById('tiempo-entrega-container');
    if(cont && sw) cont.style.display = sw.checked ? 'block' : 'none';
}

// ============================================
// DELIVERY INFO: actualizar precio según zona del cliente
// ============================================
function puntoEnPoligonoHeader(lat, lng, poligono) {
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

function actualizarDeliveryInfoHeader() {
    const precioLine = document.getElementById('delivery-precio-line');
    if (!precioLine) return;

    const zonas = window.ZONAS_DELIVERY || [];
    const zonaActiva = window.ZONA_DELIVERY_ACTIVA;

    // Si no hay zonas configuradas, mantener el texto del servidor
    if (!zonas || zonas.length === 0 || !zonaActiva) return;

    // Leer la ubicación del cliente desde localStorage
    try {
        const dirStr = localStorage.getItem('nortfood_direccion_seleccionada');
        if (!dirStr) {
            // Sin ubicación: mostrar rango de precios
            const precios = zonas.filter(z => z.precio !== undefined).map(z => z.precio);
            if (precios.length === 0) {
                precioLine.textContent = 'Envío Gratis';
            } else {
                const min = Math.min(...precios);
                const max = Math.max(...precios);
                if (min === 0 && max === 0) {
                    precioLine.textContent = 'Envío Gratis';
                } else if (min === max) {
                    precioLine.textContent = min === 0 ? 'Envío Gratis' : 'Envío $' + min;
                } else {
                    precioLine.textContent = 'Envío $' + min + ' - $' + max;
                }
            }
            return;
        }
        const dir = JSON.parse(dirStr);
        if (!dir.lat || !dir.lng) {
            precioLine.textContent = 'Envío según zona';
            return;
        }

        // Buscar la zona que contiene al cliente
        for (let zona of zonas) {
            const puntos = zona.puntos || [];
            if (puntos.length >= 3 && puntoEnPoligonoHeader(dir.lat, dir.lng, puntos)) {
                const precio = zona.precio || 0;
                precioLine.textContent = precio === 0 ? 'Envío Gratis' : 'Envío $' + precio;
                return;
            }
        }

        // No está en ninguna zona
        precioLine.textContent = 'Fuera de zona';
        precioLine.style.color = '#e74c3c';

    } catch(e) {
        console.warn('Error al calcular delivery por zona:', e);
    }
}

// ============================================
// CODIGO REPARTIDOR
// ============================================
function copiarCodigoRepartidor() {
    const codeEl = document.getElementById('repartidor-codigo-display');
    if (!codeEl) return;
    const codigo = codeEl.textContent.trim();
    if (navigator.clipboard) {
        navigator.clipboard.writeText(codigo).then(() => {
            const btn = event.target.closest('button');
            const original = btn.textContent;
            btn.textContent = '✓ Copiado!';
            setTimeout(() => { btn.textContent = original; }, 1500);
        });
    } else {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = codigo;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const btn = event.target.closest('button');
        btn.textContent = '✓ Copiado!';
        setTimeout(() => { btn.textContent = 'Copiar'; }, 1500);
    }
}

async function regenerarCodigoRepartidor() {
    if (!confirm('¿Generar un nuevo código? El código actual dejará de funcionar para los repartidores.')) return;
    try {
        const res = await fetch('/api/repartidor/regenerar-codigo', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.nuevo_codigo) {
            const codeEl = document.getElementById('repartidor-codigo-display');
            if (codeEl) codeEl.textContent = data.nuevo_codigo;
        } else {
            alert(data.error || 'Error al generar código');
        }
    } catch(e) {
        alert('Error de conexión');
    }
}

// ============================================
// EDITAR CATEGORIA
// ============================================
function abrirEditarCat(nombre, slug) {
    const input = document.getElementById('gestion-cat-vieja');
    const inputNew = document.getElementById('gestion-cat-nueva');
    if(input) input.value = nombre;
    if(inputNew) { inputNew.value = nombre; inputNew.placeholder = 'Editar nombre'; }
    const link = document.getElementById('link-borrar-cat');
    if(link) link.href = `/eliminar-categoria/${slug}?nombre=${encodeURIComponent(nombre)}`;
    abrirModal('modal-gestion-cat');
}

// ============================================
// RESENIAS
// ============================================

// Funcion para abrir el modal de resena desde fuera del catalogo
// Se llamara desde la seccion de pedidos confirmados pasando:
//   pedidoId: ID del pedido confirmado
//   negocioId: ID del negocio a reseñar
//   slugNegocio: slug del negocio (para la URL)
function abrirResenaDesdePedido(pedidoId, negocioId, slugNegocio) {
    document.getElementById('resena-pedido-id').value = pedidoId || '';
    document.getElementById('resena-negocio-id').value = negocioId || '';
    if(slugNegocio) window.SLUG_NEGOCIO = slugNegocio;
    document.getElementById('form-resena').reset();
    abrirModal('modal-resena');
}

// Expone la funcion globalmente para que otras paginas puedan llamarla
window.abrirResenaDesdePedido = abrirResenaDesdePedido;

function enviarResena(event) {
    event.preventDefault();
    const form = document.getElementById('form-resena');
    const rapidez = form.querySelector('input[name="rapidez"]:checked');
    const calidad = form.querySelector('input[name="calidad"]:checked');
    const precio = form.querySelector('input[name="precio"]:checked');
    const comentario = document.getElementById('resena-comentario').value.trim();
    const pedidoId = document.getElementById('resena-pedido-id').value;
    const negocioId = document.getElementById('resena-negocio-id').value;

    if(!rapidez || !calidad || !precio) {
        alert('Puntuá las 3 categorías: Rapidez, Calidad y Precio');
        return;
    }

    // Usar negocioId si viene de un pedido, sino usar el slug
    const targetId = negocioId || window.NEGOCIO_ID || window.SLUG_NEGOCIO;

    fetch(`/api/resenas/${targetId}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            rapidez: parseInt(rapidez.value),
            calidad: parseInt(calidad.value),
            precio: parseInt(precio.value),
            comentario,
            pedido_id: pedidoId || null
        })
    }).then(r => r.json()).then(data => {
        if(data.ok || data.success) { cerrarModal('modal-resena'); window.location.reload(); }
        else alert(data.error || 'Error al enviar resena');
    }).catch(() => alert('Error de conexion'));
}

function enviarRespuesta(resenaId) {
    const textarea = document.getElementById('respuesta-text-' + resenaId);
    if(!textarea) return;
    const respuesta = textarea.value.trim();
    if(!respuesta) { alert('Escribe una respuesta'); return; }
    fetch(`/responder-resena/${resenaId}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ respuesta })
    }).then(r => r.json()).then(data => {
        if(data.ok) window.location.reload();
        else alert(data.error || 'Error al responder');
    }).catch(() => alert('Error de conexion'));
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    cargarCarritoDesdeStorage();
    calcularEstadoLocal();
    setInterval(calcularEstadoLocal, 60000);
    aplicarFiltros();
    renderizarSeccionesCatalogo();
    actualizarDeliveryInfoHeader();

    // Actualizar contadores del carrito
    const cont = {};
    carrito.forEach(i => cont[i.productoId] = (cont[i.productoId]||0)+1);
    for(let pid in cont) { document.querySelectorAll(`.cat-qty-num[data-producto-id="${pid}"]`).forEach(el => el.innerText = cont[pid]); }
    const cf = document.getElementById('cart-count-float'); if(cf) cf.innerText = totalCantidad;

    // Inicializar galerias Tinder y guardar instancias
    const galeriaNuevo = document.getElementById('galeria-nuevo-prod');
    if(galeriaNuevo) galeriaNuevoInstance = new GaleriaTinder('galeria-nuevo-prod', 'input-fotos-nuevo', 'orden-fotos-nuevo');

    const galeriaEdit = document.getElementById('galeria-edit-prod');
    if(galeriaEdit) galeriaEditInstance = new GaleriaTinder('galeria-edit-prod', 'input-fotos-edit', 'orden-fotos-edit');

    // Hook formularios para enviar con fetch + FormData (confiable en todos los navegadores)
    const formNuevo = document.getElementById('form-nuevo-prod');
    if(formNuevo) formNuevo.addEventListener('submit', function(e) {
        e.preventDefault();
        beforeSubmitSecciones('nuevo');
        if(galeriaNuevoInstance) {
            const formData = galeriaNuevoInstance.prepararFormData(this);
            ensureDescuentoFields(formData, 'nuevo');
            fetchConCSRF(this.action, { method: 'POST', body: formData })
                .then(r => { if(r.redirected) window.location.href = r.url; else window.location.reload(); })
                .catch(() => { alert('Error al guardar el producto. Intenta de nuevo.'); });
        } else {
            inyectarDescuentoHiddenInputs(this, 'nuevo');
            this.submit();
        }
    });

    const formEditar = document.getElementById('form-editar-prod');
    if(formEditar) formEditar.addEventListener('submit', function(e) {
        e.preventDefault();
        // Sincronizar secciones antes de enviar
        beforeSubmitSecciones('edit');
        if(galeriaEditInstance) {
            const formData = galeriaEditInstance.prepararFormData(this);
            ensureDescuentoFields(formData, 'edit');
            fetchConCSRF(this.action, { method: 'POST', body: formData })
                .then(r => { if(r.redirected) window.location.href = r.url; else window.location.reload(); })
                .catch(() => { alert('Error al guardar los cambios. Intenta de nuevo.'); });
        } else {
            inyectarDescuentoHiddenInputs(this, 'edit');
            this.submit();
        }
    });
});

// SEGURIDAD: Si después de 2 segundos el badge sigue diciendo "Calculando...", forzar actualización
setTimeout(() => {
    const badge = document.getElementById('badge-estado-local');
    if (badge && (badge.textContent === 'Calculando...' || badge.textContent === '')) {
        console.warn('Badge seguía en Calculando, forzando actualización...');
        calcularEstadoLocal();
        // Si sigue sin funcionar, mostrar como Abierto para no bloquear
        if (badge.textContent === 'Calculando...' || badge.textContent === '') {
            estadoLocalAbierto = true;
            badge.textContent = 'Abierto';
            badge.className = 'badge-estado abierto';
        }
    }
}, 2000);


// ============================================
// LISTAS DE INGREDIENTES EN SECCIONES
// ============================================
let seccionListasNueva = []; // listas para nueva sección
let seccionListasEdit = {};  // listas para edición inline: {seccionNombre: [...]}

function agregarListaSeccionNueva(data) {
    data = data || { nombre: '', ingredientes: [] };
    const idx = seccionListasNueva.length;
    seccionListasNueva.push(data);
    renderListaSeccion('nueva', idx, data);
    sincronizarListasSeccion('nueva');
}

function agregarListaSeccionEdit(seccionNombre, data) {
    data = data || { nombre: '', ingredientes: [] };
    if (!seccionListasEdit[seccionNombre]) seccionListasEdit[seccionNombre] = [];
    const idx = seccionListasEdit[seccionNombre].length;
    seccionListasEdit[seccionNombre].push(data);
    renderListaSeccion('edit-' + seccionNombre, idx, data);
    sincronizarListasSeccion('edit-' + seccionNombre);
}

function renderListaSeccion(prefix, idx, data) {
    // prefix is 'nueva' for new section, 'edit-SECCIONNAME' for inline edit
    let container;
    if (prefix === 'nueva') {
        container = document.getElementById('nueva-seccion-listas-container');
    } else {
        container = document.querySelector('.inline-edit-listas-container');
    }
    if (!container) return;
    
    const div = document.createElement('div');
    div.className = 'lista-ingrediente-item';
    div.dataset.idx = idx;
    div.style.cssText = 'background:#f9f9f9;border:1.5px solid #e0e0e0;border-radius:10px;padding:10px;margin-bottom:8px;';
    div.innerHTML = `
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
            <input type="text" placeholder="Nombre de la lista (Ej: Aderezos)" value="${escapeHTML(data.nombre||'')}" 
                style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:13px;" 
                onchange="actualizarListaSeccion('${prefix}',${idx},'nombre',this.value)">
            <button type="button" onclick="eliminarListaSeccion('${prefix}',${idx},this)" 
                style="background:#e74c3c;color:white;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:bold;font-size:12px;">X</button>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
            <input type="text" placeholder="Ingredientes separados por coma (Ej: Mayonesa, Ketchup, Mostaza)" 
                value="${escapeHTML((data.ingredientes||[]).join(', '))}" 
                style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:12px;" 
                onchange="actualizarListaSeccion('${prefix}',${idx},'ingredientes',this.value)">
        </div>
        <p style="font-size:10px;color:#999;margin:4px 0 0;">Separados por coma. Se mostrarán con check al cliente.</p>
    `;
    container.appendChild(div);
}

function actualizarListaSeccion(prefix, idx, campo, valor) {
    let listas;
    if (prefix === 'nueva') {
        listas = seccionListasNueva;
    } else {
        const seccionNombre = prefix.replace('edit-', '');
        listas = seccionListasEdit[seccionNombre];
    }
    if (!listas || !listas[idx]) return;
    if (campo === 'nombre') {
        listas[idx].nombre = valor.trim();
    } else if (campo === 'ingredientes') {
        listas[idx].ingredientes = valor.split(',').map(v => v.trim()).filter(v => v);
    }
    sincronizarListasSeccion(prefix);
}

function eliminarListaSeccion(prefix, idx, btn) {
    let listas;
    if (prefix === 'nueva') {
        listas = seccionListasNueva;
    } else {
        const seccionNombre = prefix.replace('edit-', '');
        listas = seccionListasEdit[seccionNombre];
    }
    if (!listas) return;
    listas.splice(idx, 1);
    // Re-render all lists in container
    rebuildListasSeccion(prefix);
    sincronizarListasSeccion(prefix);
}

function rebuildListasSeccion(prefix) {
    let container, listas;
    if (prefix === 'nueva') {
        container = document.getElementById('nueva-seccion-listas-container');
        listas = seccionListasNueva;
    } else {
        container = document.querySelector('.inline-edit-listas-container');
        const seccionNombre = prefix.replace('edit-', '');
        listas = seccionListasEdit[seccionNombre];
    }
    if (!container) return;
    container.innerHTML = '';
    (listas || []).forEach((lista, idx) => renderListaSeccion(prefix, idx, lista));
}

function sincronizarListasSeccion(prefix) {
    let listas;
    if (prefix === 'nueva') {
        listas = seccionListasNueva;
        const input = document.getElementById('nueva-seccion-listas-json');
        if (input) input.value = JSON.stringify(listas);
    } else {
        const seccionNombre = prefix.replace('edit-', '');
        listas = seccionListasEdit[seccionNombre];
        const input = document.querySelector('.inline-edit-listas-json');
        if (input) input.value = JSON.stringify(listas);
    }
}

// ============================================
// CSS para indicador de subida Cloudinary (inyectado dinamicamente)
// ============================================
(function injectUploadStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .upload-indicator {
            position: absolute;
            bottom: 4px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 4px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            z-index: 2;
        }
        .upload-spinner {
            width: 12px;
            height: 12px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .caja-foto {
            position: relative;
        }
    `;
    document.head.appendChild(style);
})();
