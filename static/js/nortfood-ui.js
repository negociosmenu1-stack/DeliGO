/* =========================================
   NORTFOOD - UI UTILITIES (GLOBAL)
   ========================================= */

// Helper seguro para toast (usado en varias páginas)
function _toast(msg, type) {
    if (typeof NortUI !== 'undefined' && NortUI.toast) {
        NortUI.toast(msg, type);
    } else {
        alert(msg);
    }
}


// ============================================
// REPETIR PEDIDO
// ============================================

async function repetirPedido(pedidoId) {
    if (!pedidoId) {
        _toast('ID de pedido inválido', 'error');
        return;
    }

    try {
        const res = await fetch('/api/pedidos/' + pedidoId + '/repetir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (!res.ok) {
            _toast(data.error || 'No se pudo repetir el pedido', 'error');
            return;
        }

        const negocioSlug = data.negocio_slug;
        if (!negocioSlug) {
            _toast('No se encontró el negocio del pedido', 'error');
            return;
        }

        // Si no hay items para repetir, avisar
        if (!data.items_repetir || data.items_repetir.length === 0) {
            _toast('Ningún producto del pedido está disponible actualmente', 'error');
            return;
        }

        // Si hay items que ya no están disponibles, avisar
        if (data.items_sin_match && data.items_sin_match.length > 0) {
            const nombres = data.items_sin_match.map(i => i.nombre).join(', ');
            const continuar = confirm(
                'Los siguientes productos ya no están disponibles:\n\n' +
                nombres + '\n\n' +
                '¿Querés agregar igualmente los productos que sí están disponibles?'
            );
            if (!continuar) return;
        }

        // Cargar carrito actual del negocio (o crear vacío)
        const storageKey = 'nortfood_carrito_' + negocioSlug;
        let carrito = [];
        try {
            const guardado = localStorage.getItem(storageKey);
            if (guardado) {
                const parsed = JSON.parse(guardado);
                carrito = parsed.carrito || [];
            }
        } catch (e) { /* carrito vacío */ }

        // Agregar items del pedido repetido al carrito con TODOS sus datos
        for (const item of data.items_repetir) {
            carrito.push({
                productoId: item.productoId,
                nombre: item.nombre,
                precio: item.precio,
                cantidad: item.cantidad || 1,
                agregados: item.agregados || [],
                secciones: item.secciones || {},
                ingredientes: item.ingredientes || [],
                ingredientesQuitados: item.ingredientesQuitados || [],
                listasSeccion: item.listasSeccion || [],
                listasSeccionQuitados: item.listasSeccionQuitados || {},
                seccionesPrecios: item.seccionesPrecios || {},
                talle: item.talle || '',
                color: item.color || ''
            });
        }

        // Calcular total del carrito actualizado
        const total = carrito.reduce((sum, i) => {
            let p = i.precio || 0;
            if (i.seccionesPrecios) { for (const k in i.seccionesPrecios) p += i.seccionesPrecios[k]; }
            if (i.agregados) i.agregados.forEach(a => p += (a.precio || 0));
            return sum + p * (i.cantidad || 1);
        }, 0);

        localStorage.setItem(storageKey, JSON.stringify({
            carrito: carrito,
            total: total,
            totalCantidad: carrito.length
        }));

        _toast('¡Pedido agregado al carrito!', 'success');

        // Redirigir al carrito del negocio
        setTimeout(() => {
            window.location.href = '/' + negocioSlug + '/carrito';
        }, 800);

    } catch (e) {
        console.error('Error al repetir pedido:', e);
        _toast('Error de conexión al repetir el pedido', 'error');
    }
}

// Exportar globalmente para onclick en templates
window.repetirPedido = repetirPedido;
