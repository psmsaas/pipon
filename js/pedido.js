import { signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { addDoc, getDocs, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { auth, coleccion, documento } from './firebase.js';
import { formatearDinero, escaparHtml, modoPrueba, mostrarAviso, bannerPrueba } from './utils.js';

const MODO_PRUEBA = modoPrueba();
const contactoId = new URLSearchParams(location.search).get('c');

let productos = [];
let contacto = null;
let cantidades = {};
let enviando = false;
let whatsappPipon = '';

const descuentoActual = () => Number(contacto?.descuento) || 0;

const itemsPedido = () => productos
    .filter(p => cantidades[p.id] > 0)
    .map(p => ({ productoId: p.id, nombre: p.nombre, cantidad: cantidades[p.id], precio: Number(p.precio) }));

const calcularTotales = (items, descuento) => {
    const unidades = items.reduce((s, it) => s + it.cantidad, 0);
    const subtotal = items.reduce((s, it) => s + it.cantidad * it.precio, 0);
    const montoDescuento = Math.round(subtotal * descuento / 100);
    return { unidades, subtotal, descuento, montoDescuento, total: subtotal - montoDescuento };
};

function renderProductos() {
    const cont = document.getElementById('lista-productos');
    if (!productos.length) {
        cont.innerHTML = `<p class="text-center text-gray-500 py-8 bg-white rounded-2xl border border-dashed border-gray-300">No hay productos disponibles por ahora.</p>`;
    } else {
        cont.innerHTML = productos.map(p => {
            const cant = cantidades[p.id] || 0;
            return `
            <div class="flex items-center gap-3 bg-white rounded-2xl p-3 shadow-sm border-2 transition-colors ${cant ? 'border-pipon-orange' : 'border-transparent'}">
                <div class="w-14 h-14 rounded-full bg-gray-50 overflow-hidden flex items-center justify-center border border-gray-100 shrink-0">
                    ${p.foto ? `<img src="${p.foto}" class="w-full h-full object-cover">` : `<i class="fa-solid fa-box text-xl text-gray-300"></i>`}
                </div>
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-gray-800 leading-tight">${escaparHtml(p.nombre)}</p>
                    <p class="text-sm font-black text-pipon-orange">${formatearDinero(p.precio)} <span class="text-[10px] text-gray-400 font-bold">c/u</span></p>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button type="button" data-id="${p.id}" onclick="cambiarCantidad(this.dataset.id, -1)" class="w-9 h-9 rounded-full bg-gray-100 text-gray-600 active:scale-90 transition-transform"><i class="fa-solid fa-minus text-xs"></i></button>
                    <input type="number" min="0" inputmode="numeric" value="${cant}" data-id="${p.id}" onchange="fijarCantidad(this.dataset.id, this.value)" onfocus="this.select()" class="w-11 text-center font-black text-lg text-gray-800 bg-transparent outline-none">
                    <button type="button" data-id="${p.id}" onclick="cambiarCantidad(this.dataset.id, 1)" class="w-9 h-9 rounded-full bg-pipon-orange text-white active:scale-90 transition-transform"><i class="fa-solid fa-plus text-xs"></i></button>
                </div>
            </div>`;
        }).join('');
    }
    renderResumen();
}

function renderResumen() {
    const t = calcularTotales(itemsPedido(), descuentoActual());
    document.getElementById('resumen').innerHTML = `
        <div class="flex justify-between items-center">
            <span class="text-gray-500 font-medium">${t.unidades} ${t.unidades === 1 ? 'unidad' : 'unidades'}${t.descuento ? ` · <span class="text-violet-600 font-bold">-${t.descuento}% aplicado</span>` : ''}</span>
            <span class="text-2xl font-black text-pipon-brown">${formatearDinero(t.total)}</span>
        </div>
        ${t.descuento && t.subtotal ? `<p class="text-right text-xs text-gray-400 line-through">${formatearDinero(t.subtotal)}</p>` : ''}`;
}

window.cambiarCantidad = (id, delta) => {
    cantidades[id] = Math.max(0, (cantidades[id] || 0) + delta);
    renderProductos();
};

window.fijarCantidad = (id, valor) => {
    cantidades[id] = Math.max(0, parseInt(valor, 10) || 0);
    renderProductos();
};

window.enviarPedido = async (e) => {
    e.preventDefault();
    if (enviando) return;

    const items = itemsPedido();
    if (!items.length) { mostrarAviso('Agregá al menos un producto.', 'error'); return; }

    const nombre = contacto ? contacto.nombre : document.getElementById('cliente-nombre').value.trim();
    const telefono = contacto ? (contacto.telefono || '') : document.getElementById('cliente-telefono').value.trim();
    if (!contacto) {
        if (!nombre) { mostrarAviso('Escribí el nombre de tu negocio.', 'error'); return; }
        if (telefono.replace(/\D/g, '').length < 8) { mostrarAviso('Escribí un WhatsApp válido.', 'error'); return; }
    }

    const totales = calcularTotales(items, descuentoActual());
    const pedido = {
        mayoristaId: contacto?.id || null,
        mayoristaNombre: nombre,
        mayoristaTelefono: telefono,
        items,
        ...totales,
        notas: document.getElementById('pedido-notas').value.trim(),
        estado: 'pendiente',
        origen: 'link',
        timestamp: new Date()
    };

    enviando = true;
    const btn = document.getElementById('btn-enviar');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Enviando...';
    try {
        if (!MODO_PRUEBA) await addDoc(coleccion('pedidos'), pedido);
        mostrarExito(pedido);
    } catch (error) {
        console.error(error);
        mostrarAviso('No se pudo enviar. Intentá de nuevo.', 'error');
        btn.disabled = false;
        btn.innerText = 'Enviar Pedido';
    } finally {
        enviando = false;
    }
};

function mostrarExito(pedido) {
    document.getElementById('form-pedido').classList.add('hidden');
    document.getElementById('pantalla-exito').classList.remove('hidden');
    window.scrollTo(0, 0);

    document.getElementById('resumen-exito').innerHTML = `
        ${pedido.items.map(it => `<div class="flex justify-between"><span class="text-gray-600"><b class="text-pipon-brown">${it.cantidad} ×</b> ${escaparHtml(it.nombre)}</span></div>`).join('')}
        <div class="flex justify-between border-t border-gray-200 mt-2 pt-2 font-black text-pipon-brown"><span>Total</span><span>${formatearDinero(pedido.total)}</span></div>
        ${MODO_PRUEBA ? '<p class="text-[11px] text-yellow-700 font-bold mt-2">MODO PRUEBA: este pedido no se guardó.</p>' : ''}`;

    if (whatsappPipon) {
        const texto = `¡Hola Pipón! Soy ${pedido.mayoristaNombre} y acabo de hacer un pedido:\n${pedido.items.map(it => `• ${it.cantidad} x ${it.nombre}`).join('\n')}\nTotal: ${formatearDinero(pedido.total)}`;
        const btn = document.getElementById('btn-avisar');
        btn.href = `https://wa.me/${whatsappPipon}?text=${encodeURIComponent(texto)}`;
        btn.classList.remove('hidden');
        btn.classList.add('flex');
    }
}

async function iniciar() {
    if (MODO_PRUEBA) bannerPrueba('El pedido no se guarda');
    try {
        // si ya hay una sesión del sistema en este dispositivo no la pisamos con una anónima
        await auth.authStateReady();
        if (!auth.currentUser) await signInAnonymously(auth);
        const snap = await getDocs(coleccion('productos'));
        const ajustes = await getDoc(documento('ajustes', 'publico')).catch(() => null);
        whatsappPipon = String(ajustes?.data()?.whatsapp || '').replace(/\D/g, '');

        productos = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.nombre.localeCompare(b.nombre));

        if (contactoId) {
            const docContacto = await getDoc(documento('mayoristas', contactoId));
            if (docContacto.exists()) contacto = { id: docContacto.id, ...docContacto.data() };
        }

        if (contacto) {
            document.getElementById('saludo').innerText = `¡Hola, ${contacto.nombre}!`;
            if (descuentoActual()) {
                const chip = document.getElementById('saludo-descuento');
                chip.innerText = `Tenés un ${descuentoActual()}% de descuento en tu pedido`;
                chip.classList.remove('hidden');
            }
        } else {
            document.getElementById('datos-cliente').classList.remove('hidden');
        }

        renderProductos();
        document.getElementById('pantalla-carga').classList.add('hidden');
        document.getElementById('form-pedido').classList.remove('hidden');
    } catch (error) {
        console.error(error);
        document.getElementById('pantalla-carga').classList.add('hidden');
        document.getElementById('pantalla-error').classList.remove('hidden');
    }
}

iniciar();
