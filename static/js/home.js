// ============================================
// NORTFOOD - HOME / MARKETPLACE JS
// ============================================

// Helper seguro para toast (NortUI puede no estar disponible en todas las páginas)
function _toast(msg, type) {
    if (typeof NortUI !== 'undefined' && NortUI.toast) {
        NortUI.toast(msg, type);
    } else {
        alert(msg);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const pills = document.querySelectorAll('.category-pill');
    const subFilters = document.querySelectorAll('.sub-filter-pill');
    const cards = document.querySelectorAll('.business-card');
    const searchInput = document.getElementById('search-input');
    const noResults = document.getElementById('no-results');

    let activeFilter = 'todos';
    let activeSort = 'populares';

    // ============================================
    // FILTRADO POR ZONA DE DELIVERY
    // ============================================
    let clienteLat = null;
    let clienteLng = null;
    let fueraDeZonaSlugs = new Set(); // Slugs de negocios fuera de zona
    let ubicacionCargada = false;

    // Cargar ubicación del cliente
    cargarUbicacionCliente();

    async function cargarUbicacionCliente() {
        // Intentar con dirección guardada en localStorage
        const dirGuardada = localStorage.getItem('nortfood_direccion_seleccionada');
        if (dirGuardada) {
            try {
                const dir = JSON.parse(dirGuardada);
                if (dir.lat && dir.lng) {
                    clienteLat = parseFloat(dir.lat);
                    clienteLng = parseFloat(dir.lng);
                    ubicacionCargada = true;
                    actualizarBotonUbicacion(dir.alias || dir.direccion || 'Mi ubicación');
                    filtrarPorZonaDelivery();
                    return;
                }
            } catch(e) {}
        }

        // Si el cliente está logueado, mostrar modal de selección
        if (window.CLIENTE_ID) {
            abrirModalUbicacion();
        } else {
            // Si no está logueado, intentar GPS como fallback
            if ('geolocation' in navigator) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        clienteLat = pos.coords.latitude;
                        clienteLng = pos.coords.longitude;
                        ubicacionCargada = true;
                        localStorage.setItem('nortfood_direccion_seleccionada', JSON.stringify({
                            lat: clienteLat, lng: clienteLng, alias: 'Mi ubicación actual'
                        }));
                        filtrarPorZonaDelivery();
                    },
                    (err) => {
                        console.log('Ubicación no disponible, mostrando todos los locales');
                    },
                    { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
                );
            }
        }
    }

    // Algoritmo ray-casting: verifica si un punto está dentro de un polígono
    // poligono = [[lat, lng], [lat, lng], ...]
    function puntoEnPoligono(lat, lng, poligono) {
        if (!poligono || poligono.length < 3) return true;
        let dentro = false;
        const n = poligono.length;
        let j = n - 1;
        for (let i = 0; i < n; i++) {
            const lat_i = poligono[i][0], lng_i = poligono[i][1];
            const lat_j = poligono[j][0], lng_j = poligono[j][1];
            // Ray casting: lanzamos rayo horizontal desde (lng, lat) hacia la derecha
            if ((lat_i > lat) !== (lat_j > lat) &&
                (lng < (lng_j - lng_i) * (lat - lat_i) / (lat_j - lat_i) + lng_i)) {
                dentro = !dentro;
            }
            j = i;
        }
        return dentro;
    }

    function filtrarPorZonaDelivery() {
        if (!ubicacionCargada || clienteLat === null || clienteLng === null) return;

        fueraDeZonaSlugs.clear();
        let countFuera = 0;

        cards.forEach(card => {
            const zonaActiva = card.dataset.zonaActiva === '1';
            if (!zonaActiva) return; // Sin zona activa = siempre visible

            const slug = card.dataset.slug;
            let zonasStr = card.dataset.zonasDelivery || '[]';
            let zonas;
            try {
                zonas = JSON.parse(zonasStr);
            } catch(e) {
                return; // Error parseando = mostrar
            }

            // Si no hay zonas definidas, mostrar el negocio (no filtrar)
            if (!zonas || zonas.length === 0) return;

            // Filtrar solo zonas con puntos válidos (≥3)
            let zonasValidas = zonas.filter(z => z.puntos && z.puntos.length >= 3);
            if (zonasValidas.length === 0) return; // No hay zonas dibujadas = mostrar

            // Verificar si el cliente está en ALGUNA de las zonas válidas
            let enZona = false;
            let precioZona = null;
            for (let zona of zonasValidas) {
                if (puntoEnPoligono(clienteLat, clienteLng, zona.puntos)) {
                    enZona = true;
                    precioZona = zona.precio || 0;
                    break;
                }
            }

            if (!enZona) {
                fueraDeZonaSlugs.add(slug);
                countFuera++;
            } else {
                // Guardar el precio de la zona en la tarjeta para mostrarlo
                card.dataset.precioZonaUsuario = precioZona;
            }
        });

        // Actualizar precios de delivery en las tarjetas visibles
        actualizarPreciosDelivery();

        // Re-aplicar filtros
        applyFilters();

        // Mostrar aviso si hay negocios fuera de zona
        const noZona = document.getElementById('no-zona-results');
        if (noZona) {
            noZona.style.display = countFuera > 0 ? 'block' : 'none';
        }
    }

    // Actualizar el texto de precio de delivery en cada tarjeta visible
    function actualizarPreciosDelivery() {
        cards.forEach(card => {
            const precioEl = card.querySelector('.delivery-price-text');
            if (!precioEl) return;

            if (ubicacionCargada && clienteLat !== null && card.dataset.precioZonaUsuario !== undefined) {
                const precio = parseInt(card.dataset.precioZonaUsuario);
                if (precio === 0) {
                    precioEl.textContent = 'Envío Gratis';
                } else {
                    precioEl.textContent = 'Envío $' + precio;
                }
            }
            // Si no hay ubicación, el texto del template ("Envío desde $min") se mantiene
        });
    }

    // Actualizar el botón de ubicación en el header
    function actualizarBotonUbicacion(texto) {
        const btn = document.getElementById('btn-cambiar-ubicacion');
        const btnText = document.getElementById('ubicacion-btn-text');
        if (btn && btnText) {
            btn.style.display = 'flex';
            // Acortar texto si es muy largo
            if (texto && texto.length > 25) {
                btnText.textContent = texto.substring(0, 22) + '...';
            } else {
                btnText.textContent = texto || 'Ubicación';
            }
        }
    }

    // Hacer visible globalmente para el botón
    window.limpiarUbicacionCliente = function() {
        localStorage.removeItem('nortfood_direccion_seleccionada');
        clienteLat = null;
        clienteLng = null;
        fueraDeZonaSlugs = new Set();
        ubicacionCargada = false;

        // Mostrar todas las tarjetas
        cards.forEach(card => {
            card.classList.remove('fuera-zona');
            card.style.display = '';
        });
        const noZona = document.getElementById('no-zona-results');
        if (noZona) noZona.style.display = 'none';

        applyFilters();
        _toast('Mostrando todos los locales', 'info');
    };

    // Función principal de filtrado
    function applyFilters() {
        const searchText = searchInput.value.toLowerCase().trim();
        let visibleCards = [];

        cards.forEach(card => {
            const cardRubro = card.dataset.rubro;
            const cardName = card.dataset.nombre;
            const slug = card.dataset.slug;

            const matchesCategory = (activeFilter === 'todos' || cardRubro === activeFilter);
            const matchesSearch = (!searchText || cardName.includes(searchText));
            const fueraZona = fueraDeZonaSlugs.has(slug);

            if (matchesCategory && matchesSearch && !fueraZona) {
                card.style.display = 'flex';
                visibleCards.push(card);
            } else {
                card.style.display = 'none';
            }
        });

        // Ordenar las tarjetas visibles
        if (visibleCards.length > 0) {
            const grid = document.querySelector('.business-grid');
            visibleCards.sort((a, b) => {
                if (activeSort === 'calificados') {
                    const ratingA = parseFloat(a.dataset.rating || 0);
                    const ratingB = parseFloat(b.dataset.rating || 0);
                    if (ratingB !== ratingA) return ratingB - ratingA;
                    return parseInt(b.dataset.resenas || 0) - parseInt(a.dataset.resenas || 0);
                } else if (activeSort === 'delivery') {
                    const dA = a.dataset.delivery === '1' ? 1 : 0;
                    const dB = b.dataset.delivery === '1' ? 1 : 0;
                    if (dB !== dA) return dB - dA;
                    if (dA === 1 && dB === 1) {
                        const tA = parseInt(a.dataset.tiempo || 999);
                        const tB = parseInt(b.dataset.tiempo || 999);
                        if (tA !== tB) return tA - tB;
                    }
                    return parseFloat(b.dataset.rating || 0) - parseFloat(a.dataset.rating || 0);
                } else {
                    const pA = parseInt(a.dataset.pedidos || 0);
                    const pB = parseInt(b.dataset.pedidos || 0);
                    if (pB !== pA) return pB - pA;
                    return parseFloat(b.dataset.rating || 0) - parseFloat(a.dataset.rating || 0);
                }
            });
            visibleCards.forEach(card => grid.appendChild(card));
        }

        noResults.style.display = visibleCards.length === 0 ? 'block' : 'none';
    }

    // Evento click en las píldoras de categoría
    pills.forEach(pill => {
        pill.addEventListener('click', () => {
            pills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            activeFilter = pill.dataset.filter;
            applyFilters();
        });
    });

    // Evento click en sub-filtros
    subFilters.forEach(filter => {
        filter.addEventListener('click', () => {
            subFilters.forEach(f => f.classList.remove('active'));
            filter.classList.add('active');
            activeSort = filter.dataset.sort;
            applyFilters();
        });
    });

    // Evento de escritura en el buscador
    searchInput.addEventListener('input', applyFilters);
});


// ============================================
// MODAL DE UBICACIÓN (FUNCIONES GLOBALES)
// ============================================

let ubicacionMap = null;
let ubicacionMarker = null;
const UBICACION_DEFAULT_LAT = -34.6037;
const UBICACION_DEFAULT_LNG = -58.3816;

// Abrir modal de ubicación
window.abrirModalUbicacion = function() {
    const modal = document.getElementById('modal-ubicacion');
    if (!modal) return;
    modal.style.display = 'flex';

    // Si tiene direcciones, mostrar lista; si no, mostrar form directamente
    const dirs = window.CLIENTE_DIRECCIONES || [];
    const subtitle = document.getElementById('ubicacion-subtitle');
    const btnSaltar = document.getElementById('btn-saltar-ubicacion');

    if (dirs.length === 0) {
        // Primera vez: no tiene direcciones, mostrar form directamente
        if (subtitle) subtitle.textContent = 'Agregá tu dirección para ver qué locales llegan hasta vos';
        mostrarFormularioUbicacion();
    } else {
        if (subtitle) subtitle.textContent = dirs.length === 1
            ? 'Confirmá tu dirección actual'
            : 'Seleccioná en dónde estás ahora';
    }

    // Si ya tiene dirección seleccionada, marcarla en la lista
    const dirGuardada = localStorage.getItem('nortfood_direccion_seleccionada');
    if (dirGuardada) {
        try {
            const dir = JSON.parse(dirGuardada);
            document.querySelectorAll('.ubicacion-dir-option').forEach(opt => {
                const alias = opt.querySelector('.ubicacion-dir-alias')?.textContent;
                if (alias === dir.alias) {
                    opt.classList.add('activa');
                }
            });
        } catch(e) {}
    }
};

// Seleccionar una dirección existente
window.seleccionarUbicacionExistente = function(alias, direccion, referencia, lat, lng) {
    if (!lat || !lng) {
        // Si no tiene coordenadas, permitir pero no filtrar por zona
        _toast('Esta dirección no tiene coordenadas. No se podrá filtrar por zona de delivery.', 'warning');
    }

    const dirData = { alias, direccion, referencia, lat: lat || null, lng: lng || null };
    localStorage.setItem('nortfood_direccion_seleccionada', JSON.stringify(dirData));

    // Cerrar modal
    document.getElementById('modal-ubicacion').style.display = 'none';

    // Recargar la página para aplicar el filtrado
    if (lat && lng) {
        location.reload();
    } else {
        // Sin coordenadas, no filtrar
        _toast('Dirección seleccionada (sin coordenadas para filtrar zona)', 'info');
    }
};

// Mostrar formulario de nueva dirección
window.mostrarFormularioUbicacion = function() {
    document.getElementById('ubicacion-direcciones').style.display = 'none';
    document.getElementById('ubicacion-form').style.display = 'block';
    document.getElementById('btn-saltar-ubicacion').style.display = 'none';

    // Mostrar contenedor del mapa e inicializar (igual que en perfil)
    const mapContainer = document.getElementById('ubicacion-map-container');
    const hint = document.getElementById('ubicacion-map-hint');
    if (mapContainer) mapContainer.style.display = 'block';
    if (hint) hint.style.display = 'block';

    // Intentar obtener ubicación GPS, si falla usar coordenadas por defecto
    if (navigator.geolocation) {
        const loading = document.getElementById('ubicacion-map-loading');
        if (loading) loading.style.display = 'flex';
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                if (loading) loading.style.display = 'none';
                ubicacionInitMap(pos.coords.latitude, pos.coords.longitude);
                ubicacionReverseGeocode(pos.coords.latitude, pos.coords.longitude);
            },
            () => {
                if (loading) loading.style.display = 'none';
                ubicacionInitMap(UBICACION_DEFAULT_LAT, UBICACION_DEFAULT_LNG);
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
        );
    } else {
        ubicacionInitMap(UBICACION_DEFAULT_LAT, UBICACION_DEFAULT_LNG);
    }
};

// Volver a la lista de direcciones
window.volverADirecciones = function() {
    document.getElementById('ubicacion-direcciones').style.display = 'block';
    document.getElementById('ubicacion-form').style.display = 'none';
    const dirs = window.CLIENTE_DIRECCIONES || [];
    document.getElementById('btn-saltar-ubicacion').style.display = dirs.length > 0 ? 'block' : 'none';

    // Destruir mapa si existe
    if (ubicacionMap) { ubicacionMap.remove(); ubicacionMap = null; }
};

// Usar GPS para nueva dirección
window.ubicacionUsarGPS = function() {
    const mapContainer = document.getElementById('ubicacion-map-container');
    const loading = document.getElementById('ubicacion-map-loading');
    const hint = document.getElementById('ubicacion-map-hint');

    mapContainer.style.display = 'block';
    hint.style.display = 'block';

    if (!navigator.geolocation) {
        _toast('Tu navegador no soporta geolocalización', 'error');
        ubicacionInitMap(UBICACION_DEFAULT_LAT, UBICACION_DEFAULT_LNG);
        return;
    }

    loading.style.display = 'flex';
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            loading.style.display = 'none';
            ubicacionInitMap(pos.coords.latitude, pos.coords.longitude);
            ubicacionReverseGeocode(pos.coords.latitude, pos.coords.longitude);
        },
        (err) => {
            loading.style.display = 'none';
            if (err.code === 1) {
                _toast('Permiso de ubicación denegado. Podés mover el marcador manualmente.', 'warning');
            } else {
                _toast('No se pudo obtener tu ubicación. Mové el marcador manualmente.', 'warning');
            }
            ubicacionInitMap(UBICACION_DEFAULT_LAT, UBICACION_DEFAULT_LNG);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
};

// Inicializar mapa de ubicación
function ubicacionInitMap(lat, lng) {
    if (typeof L === 'undefined') {
        document.getElementById('ubicacion-map').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:13px;">No se pudo cargar el mapa.</div>';
        return;
    }

    if (ubicacionMap) { ubicacionMap.remove(); ubicacionMap = null; }

    try {
        ubicacionMap = L.map('ubicacion-map', {
            zoomControl: true,
            attributionControl: false
        }).setView([lat, lng], 16);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(ubicacionMap);

        const markerIcon = L.divIcon({
            html: '<svg viewBox="0 0 24 36" width="30" height="45" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="#FB8C00" stroke="#e67e00" stroke-width="1"/><circle cx="12" cy="12" r="5" fill="white"/></svg>',
            iconSize: [30, 45],
            iconAnchor: [15, 45],
            popupAnchor: [0, -45],
            className: 'custom-marker-icon'
        });

        ubicacionMarker = L.marker([lat, lng], {
            icon: markerIcon,
            draggable: true,
            zIndexOffset: 1000
        }).addTo(ubicacionMap);

        ubicacionMarker.on('dragend', function(e) {
            const pos = e.target.getLatLng();
            document.getElementById('ubicacion-lat').value = pos.lat.toFixed(6);
            document.getElementById('ubicacion-lng').value = pos.lng.toFixed(6);
            ubicacionReverseGeocode(pos.lat, pos.lng);
        });

        ubicacionMap.on('click', function(e) {
            ubicacionMarker.setLatLng(e.latlng);
            document.getElementById('ubicacion-lat').value = e.latlng.lat.toFixed(6);
            document.getElementById('ubicacion-lng').value = e.latlng.lng.toFixed(6);
            ubicacionReverseGeocode(e.latlng.lat, e.latlng.lng);
        });

        document.getElementById('ubicacion-lat').value = lat.toFixed(6);
        document.getElementById('ubicacion-lng').value = lng.toFixed(6);

        setTimeout(function() { if (ubicacionMap) ubicacionMap.invalidateSize(); }, 300);
        setTimeout(function() { if (ubicacionMap) ubicacionMap.invalidateSize(); }, 700);
    } catch(err) {
        console.error('Error al crear mapa:', err);
    }
}

// Reverse geocode para dirección
function ubicacionReverseGeocode(lat, lng) {
    const dirInput = document.getElementById('ubicacion-calle');
    if (!dirInput) return;
    if (dirInput.value.trim()) return;

    fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng + '&zoom=18&addressdetails=1')
        .then(r => r.json())
        .then(data => {
            if (data && data.display_name) {
                const addr = data.address || {};
                let partes = [];
                if (addr.road) partes.push(addr.road);
                if (addr.house_number) partes.push(addr.house_number);
                if (addr.suburb || addr.neighbourhood) partes.push(addr.suburb || addr.neighbourhood);
                if (partes.length > 0) dirInput.value = partes.join(', ');
            }
        })
        .catch(() => {});
}

// Guardar nueva dirección y usarla
window.guardarUbicacionNueva = async function() {
    const alias = document.getElementById('ubicacion-alias').value.trim();
    const dir = document.getElementById('ubicacion-calle').value.trim();
    const ref = document.getElementById('ubicacion-ref').value.trim();
    const lat = document.getElementById('ubicacion-lat').value;
    const lng = document.getElementById('ubicacion-lng').value;

    if (!alias || !dir) {
        _toast('Completá al menos el alias y la dirección.', 'warning');
        return;
    }

    const dirData = { alias, direccion: dir, referencia: ref, lat: lat || null, lng: lng || null };
    localStorage.setItem('nortfood_direccion_seleccionada', JSON.stringify(dirData));

    // Guardar en la base de datos si el cliente está logueado
    if (window.CLIENTE_ID) {
        try {
            const payload = { alias, direccion: dir, referencia: ref };
            if (lat && lng) { payload.lat = parseFloat(lat); payload.lng = parseFloat(lng); }
            const res = await fetch('/cliente/agregar-direccion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) {
                console.warn('No se pudo guardar la dirección en la base de datos:', data.error);
            }
        } catch (e) {
            console.warn('Error guardando dirección en BD:', e);
        }
    }

    // Cerrar modal y recargar
    document.getElementById('modal-ubicacion').style.display = 'none';
    location.reload();
};

// Saltar selección de ubicación (ver todos los locales)
window.saltarUbicacion = function() {
    document.getElementById('modal-ubicacion').style.display = 'none';
};
