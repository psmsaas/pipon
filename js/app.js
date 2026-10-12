import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { addDoc, onSnapshot, updateDoc, deleteDoc, getDocs, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { auth, dominioAuth, coleccion, documento } from './firebase.js';
import { formatearDinero, escaparHtml, modoPrueba, mostrarAviso, bannerPrueba } from './utils.js';

// con ?prueba se leen los datos reales pero los cambios quedan en memoria
const MODO_PRUEBA = modoPrueba();
let crearDoc = addDoc;
let actualizarDoc = updateDoc;
let borrarDoc = deleteDoc;
let escuchar = onSnapshot;

if (MODO_PRUEBA) {
    const memoria = {};
    const oyentes = {};
    const cargas = {};
    const convertirFechas = (datos) => Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, v instanceof Date ? Timestamp.fromDate(v) : v]));
    const asegurar = (refColeccion) => cargas[refColeccion.path] ||= getDocs(refColeccion).then(snap => {
        memoria[refColeccion.path] = new Map(snap.docs.map(d => [d.id, d.data()]));
    });
    const emitir = (ruta) => {
        const docs = [...memoria[ruta].entries()].map(([id, datos]) => ({ id, data: () => datos }));
        (oyentes[ruta] || []).forEach(cb => cb({ docs }));
    };
    escuchar = (refColeccion, cb, alFallar) => {
        (oyentes[refColeccion.path] ||= []).push(cb);
        asegurar(refColeccion).then(() => emitir(refColeccion.path)).catch(error => alFallar?.(error));
        return () => {};
    };
    crearDoc = async (refColeccion, datos) => {
        await asegurar(refColeccion);
        const id = 'prueba-' + Date.now() + Math.random().toString(36).slice(2, 6);
        memoria[refColeccion.path].set(id, convertirFechas(datos));
        emitir(refColeccion.path);
        return { id };
    };
    actualizarDoc = async (refDoc, datos) => {
        await asegurar(refDoc.parent);
        const actual = memoria[refDoc.parent.path].get(refDoc.id) || {};
        memoria[refDoc.parent.path].set(refDoc.id, { ...actual, ...convertirFechas(datos) });
        emitir(refDoc.parent.path);
    };
    borrarDoc = async (refDoc) => {
        await asegurar(refDoc.parent);
        memoria[refDoc.parent.path].delete(refDoc.id);
        emitir(refDoc.parent.path);
    };
    bannerPrueba('Nada de lo que cargues se guarda');
}

// ventasData y gastosData tienen solo lo vigente; lo eliminado queda aparte para la papelera
let ventasData = [];
let gastosData = [];
let ventasEliminadas = [];
let gastosEliminados = [];
let productosData = [];
let mayoristasData = [];
let pedidosData = [];
let proveedoresData = [];

// solo la cuenta "admin" puede mandar a la papelera, restaurar y borrar proveedores
let esAdmin = false;
let vistaBalance = 'mes';
let fechaManual = null;
let proveedorAEliminar = null;
let transaccionAEliminar = { id: null, tipo: null };

let fechaCalendario = new Date();
let diaSeleccionadoFormat = null;

let anioBalances = new Date().getFullYear();
let mesBalancesSelec = new Date().getMonth();

const formatearHora = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};
const esHoy = (timestamp) => {
    if (!timestamp) return false;
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const hoy = new Date();
    return date.getDate() === hoy.getDate() && date.getMonth() === hoy.getMonth() && date.getFullYear() === hoy.getFullYear();
};
const esAyer = (timestamp) => {
    if (!timestamp) return false;
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    return date.getDate() === ayer.getDate() && date.getMonth() === ayer.getMonth() && date.getFullYear() === ayer.getFullYear();
};
const aFecha = (timestamp) => timestamp ? (timestamp.toDate ? timestamp.toDate() : new Date(timestamp)) : null;
const formatearFecha = (timestamp) => {
    const d = aFecha(timestamp);
    return d ? d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
};
const formatearFechaHora = (timestamp) => timestamp ? `${formatearFecha(timestamp)} ${formatearHora(timestamp)}` : '';
const diasEntre = (desde, hasta) => Math.round((new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate()) - new Date(desde.getFullYear(), desde.getMonth(), desde.getDate())) / 86400000);
const plural = (n, singular, pluralTxt) => `${n} ${n === 1 ? singular : pluralTxt}`;
const esDelMes = (timestamp, anio, mes) => {
    const d = aFecha(timestamp);
    return !!d && d.getFullYear() === anio && d.getMonth() === mes;
};
const esEsteMes = (timestamp) => esDelMes(timestamp, new Date().getFullYear(), new Date().getMonth());
const esMesPasado = (timestamp) => {
    const ref = new Date();
    ref.setDate(1);
    ref.setMonth(ref.getMonth() - 1);
    return esDelMes(timestamp, ref.getFullYear(), ref.getMonth());
};

// los gastos se asocian al proveedor por nombre; si no tiene o el proveedor ya no existe, queda "sin especificar"
const esHuerfano = (g) => !g.proveedor || !proveedoresData.some(p => p.nombre === g.proveedor);

// bloquea el botón mientras se guarda, así un doble toque no duplica el registro
async function conBotonBloqueado(e, tarea) {
    const boton = e.target.querySelector('[type="submit"]');
    if (boton.disabled) return;
    const textoOriginal = boton.innerHTML;
    boton.disabled = true;
    boton.classList.add('opacity-60');
    boton.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Guardando...';
    try {
        await tarea();
    } finally {
        // se libera cuando el modal ya terminó de cerrarse
        setTimeout(() => {
            boton.disabled = false;
            boton.classList.remove('opacity-60');
            boton.innerHTML = textoOriginal;
        }, 400);
    }
}

async function conBotonBloqueadoClick(boton, tarea) {
    if (boton.disabled) return;
    boton.disabled = true;
    boton.classList.add('opacity-60');
    try { await tarea(); } finally {
        setTimeout(() => { boton.disabled = false; boton.classList.remove('opacity-60'); }, 400);
    }
}

// un pedido mayorista entra como ingreso el día que se entrega
const ventasMayoristasEntregadas = () => pedidosData
    .filter(p => p.estado === 'entregado' && p.fechaEntrega)
    .map(p => ({ ...p, monto: p.total, timestamp: p.fechaEntrega, tipo: 'mayorista' }));
const todosLosIngresos = () => [...ventasData, ...ventasMayoristasEntregadas()];

window.cambiarVistaBalance = function(vista) {
    vistaBalance = vista;
    const activo = 'px-5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-pipon-orange text-white shadow-sm transition-all';
    const inactivo = 'px-5 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-pipon-brown hover:bg-white/50 transition-all';
    document.getElementById('btn-vista-mes').className = vista === 'mes' ? activo : inactivo;
    document.getElementById('btn-vista-dia').className = vista === 'dia' ? activo : inactivo;
    document.getElementById('lbl-balance-titulo').innerText = vista === 'mes' ? 'Balance del Mes' : 'Balance del Día (Hoy)';
    renderBalanceYResumen();
};

function renderBalanceYResumen() {
    const ingresos = todosLosIngresos();
    const [esActual, esAnterior, textoAnterior] = vistaBalance === 'dia'
        ? [esHoy, esAyer, 'Ayer:']
        : [esEsteMes, esMesPasado, 'Mes pasado:'];
    const sumar = (lista, filtro) => lista.filter(x => filtro(x.timestamp)).reduce((sum, x) => sum + Number(x.monto), 0);

    const totalVentas = sumar(ingresos, esActual);
    const totalGastos = sumar(gastosData, esActual);
    const balanceTotal = totalVentas - totalGastos;

    document.getElementById('resumen-ingresos').innerText = formatearDinero(totalVentas);
    document.getElementById('resumen-gastos').innerText = formatearDinero(totalGastos);

    const balEl = document.getElementById('balance-total');
    balEl.innerText = formatearDinero(balanceTotal);
    if (balanceTotal > 0) balEl.className = 'text-5xl font-black text-green-600 mb-1';
    else if (balanceTotal < 0) balEl.className = 'text-5xl font-black text-red-600 mb-1';
    else balEl.className = 'text-5xl font-black text-pipon-brown mb-1';

    const totalVentasAnt = sumar(ingresos, esAnterior);
    const totalGastosAnt = sumar(gastosData, esAnterior);
    const balanceAnt = totalVentasAnt - totalGastosAnt;

    const balAntEl = document.getElementById('balance-anterior');
    if (totalVentasAnt === 0 && totalGastosAnt === 0) {
        balAntEl.innerText = `${textoAnterior} Sin movimientos`;
        balAntEl.className = 'text-sm font-semibold text-gray-400';
    } else {
        balAntEl.innerText = `${textoAnterior} ${formatearDinero(balanceAnt)}`;
        if (balanceAnt > 0) balAntEl.className = 'text-sm font-bold text-green-500';
        else if (balanceAnt < 0) balAntEl.className = 'text-sm font-bold text-red-500';
        else balAntEl.className = 'text-sm font-bold text-gray-500';
    }
}

function renderVentas() {
    const ventasHoy = todosLosIngresos().filter(v => esHoy(v.timestamp)).sort((a,b) => (b.timestamp?.toMillis()||0) - (a.timestamp?.toMillis()||0));
    const total = ventasHoy.reduce((sum, v) => sum + Number(v.monto), 0);
    document.getElementById('total-ventas-hoy-badge').innerText = `Total: ${formatearDinero(total)}`;
    const listEl = document.getElementById('lista-ventas');

    if (ventasHoy.length === 0) {
        listEl.innerHTML = `<div class="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm mt-4"><i class="fa-solid fa-cash-register text-4xl text-gray-200 mb-3 block"></i><p class="text-gray-500 font-medium">Todavía no hay ventas hoy.</p></div>`;
        return;
    }

    listEl.innerHTML = ventasHoy.map(v => v.tipo === 'mayorista' ? `
        <button onclick="verDetallePedido('${v.id}')" class="w-full text-left bg-white rounded-xl p-4 flex justify-between items-center shadow-sm border-l-4 border-l-violet-500">
            <div class="min-w-0">
                <p class="font-bold text-gray-800 truncate">${escaparHtml(nombrePedido(v))}</p>
                <div class="flex items-center gap-2 mt-1">
                    <span class="text-xs text-gray-400"><i class="fa-regular fa-clock"></i> ${formatearHora(v.timestamp)}</span>
                    <span class="text-[10px] bg-violet-100 text-violet-700 font-bold px-2 py-0.5 rounded">Mayorista · ${v.unidades} u.</span>
                    <span class="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">${escaparHtml(v.metodo || '')}</span>
                </div>
            </div>
            <span class="font-black text-violet-600 text-lg shrink-0">+${formatearDinero(v.monto)}</span>
        </button>
    ` : `
        <div class="bg-white rounded-xl p-4 flex justify-between items-center shadow-sm border-l-4 border-l-green-500">
            <div>
                <p class="font-bold text-gray-800">${v.descripcion || 'Venta general'}</p>
                <div class="flex items-center gap-2 mt-1">
                    <span class="text-xs text-gray-400"><i class="fa-regular fa-clock"></i> ${formatearHora(v.timestamp)}</span>
                    <span class="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">${v.metodo}</span>
                    ${v.comprobante ? `<button onclick="verComprobante('${v.id}', 'ventas')" class="text-[10px] bg-blue-50 text-blue-500 px-2 py-0.5 rounded flex items-center gap-1 hover:bg-blue-100"><i class="fa-solid fa-paperclip"></i> Ver</button>` : ''}
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <span class="font-black text-green-600 text-lg">+${formatearDinero(v.monto)}</span>
                <button onclick="abrirEditarVenta('${v.id}')" class="w-7 h-7 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center active:bg-gray-200 transition-colors" aria-label="Editar venta"><i class="fa-solid fa-pen text-[10px]"></i></button>
            </div>
        </div>
    `).join('');
}

function renderGastos() {
    const gastosHoy = gastosData.filter(g => esHoy(g.timestamp)).sort((a,b) => (b.timestamp?.toMillis()||0) - (a.timestamp?.toMillis()||0));
    const total = gastosHoy.reduce((sum, g) => sum + Number(g.monto), 0);
    document.getElementById('total-gastos-hoy-badge').innerText = `Total: ${formatearDinero(total)}`;
    const listEl = document.getElementById('lista-gastos');

    if (gastosHoy.length === 0) {
        listEl.innerHTML = `<div class="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm mt-4"><i class="fa-solid fa-receipt text-4xl text-gray-200 mb-3 block"></i><p class="text-gray-500 font-medium">No hay gastos hoy.</p></div>`;
        return;
    }

    listEl.innerHTML = gastosHoy.map(g => `
        <div class="bg-white rounded-xl p-4 flex justify-between items-center shadow-sm border-l-4 border-l-red-500">
            <div>
                <p class="font-bold text-gray-800">${g.descripcion}</p>
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                    <span class="text-xs text-gray-400 whitespace-nowrap"><i class="fa-regular fa-clock"></i> ${formatearHora(g.timestamp)}</span>
                    <span class="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">${g.metodo}</span>
                    ${chipProveedor(g)}
                    ${g.comprobante ? `<button onclick="verComprobante('${g.id}', 'gastos')" class="text-[10px] bg-blue-50 text-blue-500 px-2 py-0.5 rounded flex items-center gap-1 hover:bg-blue-100"><i class="fa-solid fa-paperclip"></i> Ver</button>` : ''}
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <span class="font-black text-red-600 text-lg">-${formatearDinero(g.monto)}</span>
                <button onclick="abrirEditarGasto('${g.id}')" class="w-7 h-7 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center active:bg-gray-200 transition-colors" aria-label="Editar gasto"><i class="fa-solid fa-pen text-[10px]"></i></button>
            </div>
        </div>
    `).join('');
}

const chipProveedor = (g) => `<span class="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-bold whitespace-nowrap"><i class="fa-solid fa-truck"></i> ${escaparHtml(esHuerfano(g) ? 'Sin especificar' : g.proveedor)}</span>`;

function renderProveedores() {
    const listEl = document.getElementById('lista-proveedores');
    const hoy = new Date();
    const anioActual = hoy.getFullYear();
    const mesActual = hoy.getMonth();
    const resumir = (gastos) => ({
        mes: gastos.filter(g => esDelMes(g.timestamp, anioActual, mesActual)).reduce((s, g) => s + Number(g.monto), 0),
        anio: gastos.filter(g => aFecha(g.timestamp)?.getFullYear() === anioActual).reduce((s, g) => s + Number(g.monto), 0),
        total: gastos.reduce((s, g) => s + Number(g.monto), 0),
        compras: gastos.length
    });
    const filaTotales = (r, borde) => `
        <div class="grid grid-cols-3 gap-2 pt-3 border-t ${borde}">
            <div>
                <p class="text-[9px] text-gray-400 uppercase font-bold tracking-wider">Gasto Mensual</p>
                <p class="font-black text-red-500 text-sm">${formatearDinero(r.mes)}</p>
            </div>
            <div>
                <p class="text-[9px] text-gray-400 uppercase font-bold tracking-wider">Gasto Anual</p>
                <p class="font-black text-red-500 text-sm">${formatearDinero(r.anio)}</p>
            </div>
            <div>
                <p class="text-[9px] text-gray-400 uppercase font-bold tracking-wider">Transacciones</p>
                <p class="font-black text-gray-700 text-sm">${r.compras} <span class="text-[10px] text-gray-400 font-bold">· ${formatearDinero(r.total)}</span></p>
            </div>
        </div>`;

    const sinAsignar = gastosData.filter(esHuerfano).sort((a, b) => (aFecha(b.timestamp)?.getTime() || 0) - (aFecha(a.timestamp)?.getTime() || 0));
    const listaSinAsignarHtml = !sinAsignar.length ? '' : `
        <div class="mt-4 bg-white p-3 rounded-xl border border-red-100 shadow-sm">
            <h4 class="text-xs font-bold text-gray-500 uppercase mb-3 flex items-center justify-between">
                <span class="flex items-center gap-1"><i class="fa-solid fa-circle-exclamation text-pipon-orange"></i> Falta asignar proveedor</span>
                <span class="bg-gray-100 text-gray-500 px-2 rounded-full">${sinAsignar.length}</span>
            </h4>
            <div class="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
                ${sinAsignar.map(g => `
                    <div class="flex justify-between items-center bg-gray-50 p-2 rounded-lg border border-gray-100">
                        <div class="flex items-center gap-2 overflow-hidden">
                            <div class="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0"><i class="fa-solid fa-arrow-up text-[9px]"></i></div>
                            <div class="truncate">
                                <p class="text-xs font-bold text-gray-800 truncate leading-tight">${escaparHtml(g.descripcion)}</p>
                                <p class="text-[9px] text-gray-400 mt-0.5"><i class="fa-regular fa-clock"></i> ${formatearFechaHora(g.timestamp)}</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                            <span class="font-black text-red-600 text-sm">-${formatearDinero(g.monto)}</span>
                            <button onclick="abrirEditarGasto('${g.id}')" class="w-7 h-7 rounded-lg bg-gray-200 text-gray-600 flex items-center justify-center active:bg-gray-300 transition-colors" aria-label="Asignar proveedor"><i class="fa-solid fa-pen text-[10px]"></i></button>
                        </div>
                    </div>`).join('')}
            </div>
        </div>`;

    document.getElementById('gasto-sin-especificar-container').innerHTML = `
        <div class="bg-gray-50 rounded-xl p-4 border border-gray-200 shadow-sm flex flex-col gap-3">
            <div>
                <p class="font-bold text-gray-700 text-lg leading-tight">Gastos sin Especificar</p>
                <p class="text-xs text-gray-500 font-medium mt-1"><i class="fa-solid fa-tag text-gray-400"></i> Gastos varios o proveedores eliminados</p>
            </div>
            ${filaTotales(resumir(sinAsignar), 'border-gray-200')}
        </div>
        ${listaSinAsignarHtml}`;

    if (!proveedoresData.length) {
        listEl.innerHTML = `<div class="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm mt-4"><i class="fa-solid fa-truck text-4xl text-gray-200 mb-3 block"></i><p class="text-gray-500 font-medium">No hay proveedores registrados.</p></div>`;
    } else {
        listEl.innerHTML = proveedoresData.map(p => {
            const wa = linkWhatsApp(p.telefono);
            return `
            <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-l-blue-500 relative flex flex-col gap-3">
                <button onclick="abrirEditarProveedor('${p.id}')" class="absolute top-4 right-4 w-8 h-8 bg-gray-50 text-gray-400 rounded-full flex items-center justify-center hover:bg-gray-100 active:bg-gray-200 transition-colors shadow-sm" aria-label="Editar proveedor"><i class="fa-solid fa-pen text-[11px]"></i></button>
                <div class="pr-10">
                    <p class="font-bold text-gray-800 text-lg leading-tight">${escaparHtml(p.nombre)}</p>
                    ${p.detalle ? `<p class="text-xs text-gray-500 font-medium mt-1"><i class="fa-solid fa-tag text-gray-300"></i> ${escaparHtml(p.detalle)}</p>` : ''}
                    ${p.telefono ? `<p class="text-xs text-gray-400 font-medium mt-0.5"><i class="fa-solid fa-phone text-gray-300"></i> ${escaparHtml(p.telefono)}</p>` : ''}
                </div>
                ${filaTotales(resumir(gastosData.filter(g => g.proveedor === p.nombre)), 'border-gray-50')}
                ${wa ? `<a href="${wa}" target="_blank" class="w-full bg-green-50 text-green-600 rounded-lg py-2 flex items-center justify-center gap-2 font-bold text-sm hover:bg-green-100 transition-colors"><i class="fa-brands fa-whatsapp text-lg"></i> Contactar</a>` : ''}
            </div>`;
        }).join('');
    }

    const opciones = `<option value="">Sin Especificar / Otro</option>` + proveedoresData.map(p => `<option value="${escaparHtml(p.nombre)}">${escaparHtml(p.nombre)}</option>`).join('');
    const selectGasto = document.getElementById('gasto-proveedor');
    const elegido = selectGasto.value;
    selectGasto.innerHTML = opciones;
    selectGasto.value = elegido;
}

function renderProductos() {
    const listEl = document.getElementById('lista-productos');
    if (productosData.length === 0) {
        listEl.innerHTML = `<div class="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm mt-4 col-span-2"><i class="fa-solid fa-box-open text-4xl text-gray-200 mb-3 block"></i><p class="text-gray-500 font-medium">Todavía no hay productos cargados.</p></div>`;
    } else {
        listEl.innerHTML = productosData.map(p => `
            <div class="bg-white rounded-2xl p-3 shadow-sm border border-gray-100 flex flex-col items-center text-center relative overflow-hidden group">
                <button onclick="abrirEditarProducto('${p.id}')" class="absolute top-2 right-2 w-7 h-7 bg-gray-50 text-gray-400 rounded-full flex items-center justify-center hover:bg-gray-100 active:bg-gray-200 transition-colors shadow-sm border border-gray-100"><i class="fa-solid fa-pen text-[10px]"></i></button>
                <div class="w-20 h-20 bg-gray-50 rounded-full mb-3 flex items-center justify-center overflow-hidden border border-gray-100">
                    ${p.foto ? `<img src="${p.foto}" class="w-full h-full object-cover">` : `<i class="fa-solid fa-box text-2xl text-gray-300"></i>`}
                </div>
                <p class="font-bold text-gray-800 text-sm leading-tight mb-1 px-1">${p.nombre}</p>
                <span class="font-black text-pipon-orange text-lg">${formatearDinero(p.precio)}</span>
            </div>
        `).join('');
    }

    const selectVenta = document.getElementById('venta-producto');
    let opcionesHtml = `<option value="">Venta General / Otro</option>`;
    productosData.forEach(p => {
        opcionesHtml += `<option value="${p.id}">${p.nombre}</option>`;
    });
    selectVenta.innerHTML = opcionesHtml;
}

window.seleccionarProductoVenta = function() {
    const select = document.getElementById('venta-producto');
    const productId = select.value;
    const inputMonto = document.getElementById('venta-monto');

    if(productId) {
        const producto = productosData.find(p => p.id === productId);
        if(producto) inputMonto.value = producto.precio;
    } else {
        inputMonto.value = '';
    }
};

function agruparDatosPorFecha() {
    const dias = {};
    const diaDe = (item) => {
        if(!item.timestamp) return null;
        const fecha = formatearFecha(item.timestamp);
        if(!dias[fecha]) dias[fecha] = { minorista: 0, cantMinorista: 0, mayorista: 0, contactosMayorista: new Set(), unidadesMayorista: 0, gastos: 0, movimientos: [], eliminados: [] };
        return dias[fecha];
    };
    ventasData.forEach(v => {
        const dia = diaDe(v);
        if (!dia) return;
        dia.minorista += Number(v.monto);
        dia.cantMinorista += 1;
        dia.movimientos.push({ ...v, tipo: 'venta' });
    });
    ventasMayoristasEntregadas().forEach(p => {
        const dia = diaDe(p);
        if (!dia) return;
        dia.mayorista += Number(p.monto);
        dia.contactosMayorista.add(claveContactoPedido(p));
        dia.unidadesMayorista += Number(p.unidades) || 0;
        dia.movimientos.push(p);
    });
    gastosData.forEach(g => {
        const dia = diaDe(g);
        if (!dia) return;
        dia.gastos += Number(g.monto);
        dia.movimientos.push({ ...g, tipo: 'gasto' });
    });
    ventasEliminadas.forEach(v => diaDe(v)?.eliminados.push({ ...v, tipo: 'venta' }));
    gastosEliminados.forEach(g => diaDe(g)?.eliminados.push({ ...g, tipo: 'gasto' }));
    return dias;
}

const filaMovimiento = (item) => {
    const estilos = { venta: ['green', '+', 'fa-arrow-down', `abrirEditarVenta('${item.id}')`], gasto: ['red', '-', 'fa-arrow-up', `abrirEditarGasto('${item.id}')`], mayorista: ['violet', '+', 'fa-boxes-stacked', `verDetallePedido('${item.id}')`] };
    const [color, signo, icono, accion] = estilos[item.tipo];
    const titulo = item.tipo === 'mayorista' ? `Mayorista · ${nombrePedido(item)}` : (item.descripcion || 'Venta General');
    return `
    <div class="flex justify-between items-center bg-gray-50 p-2 rounded-lg border border-gray-100">
        <div class="flex items-center gap-2 overflow-hidden">
            <div class="w-6 h-6 rounded-full bg-${color}-100 text-${color}-600 flex items-center justify-center shrink-0"><i class="fa-solid ${icono} text-[9px]"></i></div>
            <div class="truncate">
                <p class="text-xs font-bold text-gray-800 truncate leading-tight">${escaparHtml(titulo)}</p>
                <div class="flex items-center gap-1 mt-0.5">
                    <span class="text-[9px] text-gray-400"><i class="fa-regular fa-clock"></i> ${formatearHora(item.timestamp)}</span>
                    ${item.tipo === 'gasto' ? chipProveedor(item) : ''}
                </div>
            </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
            <span class="font-black text-${color}-600 text-sm">${signo}${formatearDinero(item.monto)}</span>
            <button onclick="${accion}" class="w-7 h-7 rounded-lg bg-gray-200 text-gray-600 flex items-center justify-center active:bg-gray-300 transition-colors" aria-label="Ver o editar"><i class="fa-solid ${item.tipo === 'mayorista' ? 'fa-eye' : 'fa-pen'} text-[10px]"></i></button>
        </div>
    </div>`;
};

function renderHistorial() {
    const datosAgrupados = agruparDatosPorFecha();
    const grillaEl = document.getElementById('calendario-grilla');

    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mesActual = fechaCalendario.getMonth();
    const anioActual = fechaCalendario.getFullYear();
    document.getElementById('calendario-mes-anio').innerText = `${meses[mesActual]} ${anioActual}`;

    const primerDiaDelMes = new Date(anioActual, mesActual, 1).getDay();
    const diasEnElMes = new Date(anioActual, mesActual + 1, 0).getDate();

    let htmlCalendario = '';
    for (let i = 0; i < primerDiaDelMes; i++) htmlCalendario += `<div class="aspect-square"></div>`;

    const hoyStr = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

    for (let dia = 1; dia <= diasEnElMes; dia++) {
        const fechaCiclo = new Date(anioActual, mesActual, dia);
        const fechaStr = fechaCiclo.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

        const tieneDatos = datosAgrupados[fechaStr];
        const esHoyCalendario = fechaStr === hoyStr;
        const estaSeleccionado = fechaStr === diaSeleccionadoFormat;

        let clasesBtn = "w-full aspect-square rounded-full flex flex-col items-center justify-center relative font-medium transition-colors ";
        if (estaSeleccionado) clasesBtn += "bg-pipon-orange text-white shadow-md";
        else if (esHoyCalendario) clasesBtn += "bg-pipon-cream text-pipon-brown font-bold border border-pipon-yellow";
        else clasesBtn += "text-gray-600 hover:bg-gray-50 active:bg-gray-100";

        const puntos = [];
        if (tieneDatos?.cantMinorista) puntos.push('bg-pipon-orange');
        if (tieneDatos?.contactosMayorista.size) puntos.push('bg-violet-500');
        if (tieneDatos && !puntos.length && tieneDatos.gastos) puntos.push('bg-gray-300');
        const indicadorHtml = puntos.length
            ? `<div class="absolute bottom-1 flex gap-0.5">${puntos.map(color => `<span class="w-1.5 h-1.5 rounded-full ${color} ${estaSeleccionado ? 'ring-1 ring-white' : ''}"></span>`).join('')}</div>`
            : '';

        htmlCalendario += `<button onclick="seleccionarDiaHistorial('${fechaStr}')" class="${clasesBtn}"><span>${dia}</span>${indicadorHtml}</button>`;
    }

    grillaEl.innerHTML = htmlCalendario;
    actualizarCuadroDetalle(datosAgrupados);
}

function actualizarCuadroDetalle(datosAgrupados) {
    const cuadroEl = document.getElementById('detalle-dia-seleccionado');
    const papeleraEl = document.getElementById('papelera-dia-seleccionado');
    if (!diaSeleccionadoFormat) {
        cuadroEl.classList.add('hidden');
        papeleraEl.classList.add('hidden');
        return;
    }
    cuadroEl.classList.remove('hidden');
    const infoDia = datosAgrupados[diaSeleccionadoFormat] || { minorista: 0, cantMinorista: 0, mayorista: 0, contactosMayorista: new Set(), unidadesMayorista: 0, gastos: 0, movimientos: [], eliminados: [] };
    const porHora = (a, b) => (aFecha(b.timestamp)?.getTime() || 0) - (aFecha(a.timestamp)?.getTime() || 0);

    document.getElementById('detalle-movimientos-lista').innerHTML = infoDia.movimientos.length
        ? infoDia.movimientos.sort(porHora).map(filaMovimiento).join('')
        : `<p class="text-center text-xs text-gray-400 py-2">No hubo movimientos este día.</p>`;
    document.getElementById('retro-fecha-label').innerText = diaSeleccionadoFormat;

    // la papelera solo la ve la cuenta admin
    const mostrarPapelera = esAdmin && infoDia.eliminados.length > 0;
    papeleraEl.classList.toggle('hidden', !mostrarPapelera);
    if (mostrarPapelera) {
        document.getElementById('detalle-eliminados-lista').innerHTML = infoDia.eliminados.sort(porHora).map(item => `
            <div class="flex justify-between items-center bg-white/50 p-2 rounded-lg border border-red-100">
                <div class="truncate opacity-75">
                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">${item.tipo === 'venta' ? 'Venta' : 'Gasto'} · ${formatearHora(item.timestamp)}</p>
                    <p class="text-xs font-bold text-gray-600 truncate leading-tight line-through">${escaparHtml(item.descripcion || 'Venta General')} (${item.tipo === 'venta' ? '+' : '-'}${formatearDinero(item.monto)})</p>
                </div>
                <button onclick="restaurarTransaccion(this, '${item.id}', '${item.tipo}')" class="text-[10px] font-bold bg-white text-gray-600 px-3 py-1.5 rounded-lg shadow-sm border border-gray-200 hover:bg-gray-50 active:bg-gray-100 transition-colors flex items-center gap-1 shrink-0"><i class="fa-solid fa-rotate-left"></i> Restaurar</button>
            </div>`).join('');
    }
    const ingresosDia = infoDia.minorista + infoDia.mayorista;
    const balanceDia = ingresosDia - infoDia.gastos;

    document.getElementById('detalle-fecha').innerHTML = `<i class="fa-regular fa-calendar-check text-pipon-orange"></i> ${diaSeleccionadoFormat}`;
    document.getElementById('detalle-minorista-monto').innerText = formatearDinero(infoDia.minorista);
    document.getElementById('detalle-minorista-cant').innerText = plural(infoDia.cantMinorista, 'venta', 'ventas');
    document.getElementById('detalle-mayorista-monto').innerText = formatearDinero(infoDia.mayorista);
    document.getElementById('detalle-mayorista-contactos').innerText = plural(infoDia.contactosMayorista.size, 'contacto', 'contactos');
    document.getElementById('detalle-mayorista-unidades').innerText = plural(infoDia.unidadesMayorista, 'unidad', 'unidades');
    document.getElementById('detalle-ventas').innerText = formatearDinero(ingresosDia);
    document.getElementById('detalle-gastos').innerText = formatearDinero(infoDia.gastos);

    const balEl = document.getElementById('detalle-balance');
    balEl.innerText = formatearDinero(balanceDia);
    balEl.className = `text-xl font-black ${balanceDia > 0 ? 'text-green-600' : (balanceDia < 0 ? 'text-red-600' : 'text-gray-800')}`;
}

window.renderGridBalances = function() {
    const mesesAbrev = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const grilla = document.getElementById('balances-meses-grilla');
    document.getElementById('balances-anio').innerText = anioBalances;

    let html = '';
    mesesAbrev.forEach((mes, index) => {
        let clases = "py-3 rounded-xl font-bold text-sm transition-all border outline-none active:scale-95 ";
        if (index === mesBalancesSelec) {
            clases += "bg-pipon-orange text-white border-pipon-orange shadow-md";
        } else {
            clases += "bg-white text-gray-600 border-gray-200 hover:bg-gray-50";
        }
        html += `<button onclick="seleccionarMesBalances(${index})" class="${clases}">${mes}</button>`;
    });
    grilla.innerHTML = html;
    actualizarDetalleBalances();
};

window.cambiarAnioBalances = function(dir) {
    anioBalances += dir;
    renderGridBalances();
};

window.seleccionarMesBalances = function(mesIndex) {
    mesBalancesSelec = mesIndex;
    renderGridBalances();
};

function actualizarDetalleBalances() {
    const detalleEl = document.getElementById('detalle-balances');
    detalleEl.classList.remove('hidden');

    const ventasMes = todosLosIngresos().filter(v => {
        if(!v.timestamp) return false;
        const d = v.timestamp.toDate ? v.timestamp.toDate() : new Date(v.timestamp);
        return d.getFullYear() === anioBalances && d.getMonth() === mesBalancesSelec;
    });

    const gastosMes = gastosData.filter(g => {
        if(!g.timestamp) return false;
        const d = g.timestamp.toDate ? g.timestamp.toDate() : new Date(g.timestamp);
        return d.getFullYear() === anioBalances && d.getMonth() === mesBalancesSelec;
    });

    const totalVentas = ventasMes.reduce((sum, v) => sum + Number(v.monto), 0);
    const totalGastos = gastosMes.reduce((sum, g) => sum + Number(g.monto), 0);
    const balanceNeta = totalVentas - totalGastos;

    document.getElementById('bal-ingresos').innerText = formatearDinero(totalVentas);
    const totalMayorista = ventasMes.filter(v => v.tipo === 'mayorista').reduce((sum, v) => sum + Number(v.monto), 0);
    document.getElementById('bal-ingresos-split').innerText = totalMayorista
        ? `Minorista ${formatearDinero(totalVentas - totalMayorista)} · Mayorista ${formatearDinero(totalMayorista)}`
        : '';
    document.getElementById('bal-gastos').innerText = formatearDinero(totalGastos);

    const balNetoEl = document.getElementById('bal-neto');
    balNetoEl.innerText = formatearDinero(balanceNeta);
    balNetoEl.className = `text-2xl font-black ${balanceNeta > 0 ? 'text-green-600' : (balanceNeta < 0 ? 'text-red-600' : 'text-gray-800')}`;

    const estadisticasProd = {};
    const statProd = (nombre) => estadisticasProd[nombre] ||= { cantidad: 0, unidadesMayorista: 0, recaudado: 0 };
    ventasMes.forEach(v => {
        if (v.tipo === 'mayorista') {
            const factor = 1 - (Number(v.descuento) || 0) / 100;
            (v.items || []).forEach(it => {
                const stat = statProd(it.nombre);
                stat.unidadesMayorista += Number(it.cantidad);
                stat.recaudado += Number(it.cantidad) * Number(it.precio) * factor;
            });
            return;
        }
        const stat = statProd(v.descripcion || 'Venta General');
        stat.cantidad += 1;
        stat.recaudado += Number(v.monto);
    });

    const ranking = Object.keys(estadisticasProd)
        .map(k => ({ nombre: k, ...estadisticasProd[k] }))
        .sort((a, b) => b.recaudado - a.recaudado);

    const listEl = document.getElementById('balances-ranking');
    if (ranking.length === 0) {
        listEl.innerHTML = `<p class="text-center text-gray-400 py-4 text-sm font-medium border border-dashed border-gray-200 rounded-xl">No hay ventas registradas en este mes.</p>`;
    } else {
        listEl.innerHTML = ranking.map((prod, index) => `
            <div class="flex justify-between items-center bg-gray-50 rounded-xl p-3 border border-gray-100">
                <div class="flex items-center gap-3">
                    <span class="w-6 h-6 rounded-full bg-pipon-cream text-pipon-orange flex items-center justify-center font-black text-xs shrink-0">${index + 1}</span>
                    <div>
                        <p class="font-bold text-gray-800 text-sm leading-tight">${prod.nombre}</p>
                        <p class="text-[11px] text-gray-500 font-medium">${[
                            prod.cantidad ? plural(prod.cantidad, 'venta registrada', 'ventas registradas') : '',
                            prod.unidadesMayorista ? `${prod.unidadesMayorista} u. mayorista` : ''
                        ].filter(Boolean).join(' · ')}</p>
                    </div>
                </div>
                <span class="font-black text-pipon-brown shrink-0">${formatearDinero(prod.recaudado)}</span>
            </div>
        `).join('');
    }

    const estadisticasProv = {};
    gastosMes.forEach(g => {
        const nombre = esHuerfano(g) ? 'Sin especificar' : g.proveedor;
        const stat = estadisticasProv[nombre] ||= { cantidad: 0, gastado: 0 };
        stat.cantidad += 1;
        stat.gastado += Number(g.monto);
    });
    const rankingGastos = Object.entries(estadisticasProv)
        .map(([nombre, stat]) => ({ nombre, ...stat }))
        .sort((a, b) => b.gastado - a.gastado);

    const listProvEl = document.getElementById('balances-gastos-proveedores');
    if (rankingGastos.length === 0) {
        listProvEl.innerHTML = `<p class="text-center text-gray-400 py-4 text-sm font-medium border border-dashed border-gray-200 rounded-xl">No hay gastos registrados en este mes.</p>`;
    } else {
        listProvEl.innerHTML = rankingGastos.map(prov => {
            const sinEspecificar = prov.nombre === 'Sin especificar';
            return `
            <div class="flex justify-between items-center bg-gray-50 rounded-xl p-3 border border-gray-100">
                <div class="flex items-center gap-3">
                    <span class="w-6 h-6 rounded-full ${sinEspecificar ? 'bg-gray-200 text-gray-500' : 'bg-blue-50 text-blue-500'} flex items-center justify-center shrink-0"><i class="fa-solid ${sinEspecificar ? 'fa-tag' : 'fa-truck'} text-[9px]"></i></span>
                    <div>
                        <p class="font-bold text-gray-800 text-sm leading-tight">${escaparHtml(prov.nombre)}</p>
                        <p class="text-[11px] text-gray-500 font-medium">${plural(prov.cantidad, 'movimiento', 'movimientos')}</p>
                    </div>
                </div>
                <span class="font-black text-red-600 shrink-0">-${formatearDinero(prov.gastado)}</span>
            </div>`;
        }).join('');
    }
}

window.cambiarMes = function(cambio) { fechaCalendario.setMonth(fechaCalendario.getMonth() + cambio); renderHistorial(); }
window.seleccionarDiaHistorial = function(fechaStr) { diaSeleccionadoFormat = fechaStr; renderHistorial(); }

window.cambiarPestana = function(pestana) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`content-${pestana}`).classList.remove('hidden');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('text-pipon-orange');
        btn.classList.add('text-gray-400');
    });
    const activeBtn = document.getElementById(`nav-${pestana}`);
    activeBtn.classList.remove('text-gray-400');
    activeBtn.classList.add('text-pipon-orange');

    if (pestana === 'historial' && !diaSeleccionadoFormat) {
        const hoy = new Date();
        fechaCalendario = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        diaSeleccionadoFormat = hoy.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        renderHistorial();
    }
    if (pestana === 'balances') {
        renderGridBalances();
    }
    if (pestana === 'mayorista') {
        renderMayorista();
    }
    if (pestana === 'proveedores') {
        renderProveedores();
    }
    if (pestana === 'crm') {
        renderCrm();
    }
};

window.alternarMenuRapido = function() {
    const menu = document.getElementById('fab-menu');
    const overlay = document.getElementById('fab-overlay');
    const icon = document.getElementById('fab-icon');

    if(menu.classList.contains('active')) {
        menu.classList.remove('active', 'pointer-events-auto');
        menu.classList.add('pointer-events-none');
        overlay.classList.add('hidden');
        overlay.classList.remove('opacity-100');
        icon.style.transform = 'rotate(0deg)';
    } else {
        menu.classList.add('active', 'pointer-events-auto');
        menu.classList.remove('pointer-events-none');
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.add('opacity-100'), 10);
        icon.style.transform = 'rotate(45deg)';
    }
};

window.abrirModal = function(modalId) {
    const modal = document.getElementById(modalId);
    const modalContent = modal.querySelector('div');
    modal.classList.remove('hidden');
    modalContent.classList.remove('modal-exit');
    modalContent.classList.add('modal-enter');

    setTimeout(() => {
        if(modalId === 'modalVenta') document.getElementById('venta-monto').focus();
        else if(modalId === 'modalGasto') document.getElementById('gasto-monto').focus();
        else if(modalId === 'modalProducto') document.getElementById('producto-nombre').focus();
        else if(modalId === 'modalProveedor') document.getElementById('prov-nombre').focus();
    }, 300);
};

window.cerrarModal = function(modalId) {
    const modal = document.getElementById(modalId);
    const modalContent = modal.querySelector('div');
    modalContent.classList.remove('modal-enter');
    modalContent.classList.add('modal-exit');

    setTimeout(() => { modal.classList.add('hidden'); }, 300);

    if(modalId === 'modalVenta') {
        document.getElementById('form-venta').reset();
        limpiarImagen('venta');
        document.getElementById('venta-metodo').value = "Efectivo";
        document.querySelectorAll('.metodo-btn-venta')[0].className = "metodo-btn-venta border-2 border-green-500 bg-green-50 text-green-700 font-bold py-3 rounded-xl transition-all";
        document.querySelectorAll('.metodo-btn-venta')[1].className = "metodo-btn-venta border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-xl transition-all";
        document.getElementById('banner-retro-venta').classList.add('hidden');
        fechaManual = null;
    }
    if(modalId === 'modalGasto') {
        document.getElementById('form-gasto').reset();
        limpiarImagen('gasto');
        document.getElementById('gasto-metodo').value = "Efectivo";
        document.querySelectorAll('.metodo-btn-gasto')[0].className = "metodo-btn-gasto border-2 border-red-500 bg-red-50 text-red-700 font-bold py-3 rounded-xl transition-all";
        document.querySelectorAll('.metodo-btn-gasto')[1].className = "metodo-btn-gasto border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-xl transition-all";
        document.getElementById('banner-retro-gasto').classList.add('hidden');
        fechaManual = null;
    }
    if(modalId === 'modalEditarVenta') document.getElementById('form-editar-venta').reset();
    if(modalId === 'modalEditarGasto') document.getElementById('form-editar-gasto').reset();
    if(modalId === 'modalProveedor') document.getElementById('form-proveedor').reset();
    if(modalId === 'modalEditarProveedor') document.getElementById('form-editar-proveedor').reset();
    if(modalId === 'modalProducto') {
        document.getElementById('form-producto').reset();
        limpiarImagen('producto');
    }
    if(modalId === 'modalEditarProducto') {
        document.getElementById('form-editar-producto').reset();
        limpiarImagen('edit-producto');
    }
    if(modalId === 'modalVenta') {
        document.getElementById('form-pedido').reset();
        document.getElementById('pedido-edit-id').value = '';
        cantidadesPedido = {};
    }
    if(modalId === 'modalContacto') document.getElementById('form-contacto').reset();
    if(modalId === 'modalPedidoDetalle') pedidoDetalleAbierto = null;
    if(modalId === 'modalHistorialContacto') historialContactoAbierto = null;
};

window.seleccionarMetodo = function(tipo, metodo, elementoBtn) {
    document.getElementById(`${tipo}-metodo`).value = metodo;
    const botones = document.querySelectorAll(`.metodo-btn-${tipo}`);
    botones.forEach(btn => {
        btn.className = `metodo-btn-${tipo} border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-xl transition-all`;
    });
    if (tipo === 'venta') {
        elementoBtn.className = `metodo-btn-${tipo} border-2 border-green-500 bg-green-50 text-green-700 font-bold py-3 rounded-xl transition-all`;
    } else {
        elementoBtn.className = `metodo-btn-${tipo} border-2 border-red-500 bg-red-50 text-red-700 font-bold py-3 rounded-xl transition-all`;
    }
};

// "Venta pasada" / "Gasto pasado" desde el Historial: se guarda en ese día con la hora actual
window.abrirRegistroRetroactivo = function(tipo) {
    const fecha = diaSeleccionadoFormat;
    if (tipo === 'venta') abrirVenta('minorista');
    else abrirModal('modalGasto');
    fechaManual = fecha;
    if (tipo === 'venta') document.getElementById('selector-tipo-venta').classList.add('hidden');
    document.getElementById(`banner-retro-${tipo}`).classList.remove('hidden');
    document.getElementById(`banner-retro-${tipo}-fecha`).innerText = fecha;
};

function obtenerFechaTransaccion() {
    if (!fechaManual) return new Date();
    const [dia, mes, anio] = fechaManual.split('/').map(Number);
    const ahora = new Date();
    return new Date(anio, mes - 1, dia, ahora.getHours(), ahora.getMinutes(), ahora.getSeconds());
}

window.guardarVenta = async function(e) {
    e.preventDefault();
    await conBotonBloqueado(e, async () => {
        const monto = document.getElementById('venta-monto').value;
        const selectProd = document.getElementById('venta-producto');
        let desc = "Venta General";
        if (selectProd.value) {
            desc = selectProd.options[selectProd.selectedIndex].text;
        }
        const metodo = document.getElementById('venta-metodo').value;
        const comprobante = document.getElementById('venta-comprobante-base64').value;

        try {
            const ventasRef = coleccion('ventas');
            const data = { monto: Number(monto), descripcion: desc, metodo: metodo, timestamp: obtenerFechaTransaccion() };
            if(comprobante) data.comprobante = comprobante;

            await crearDoc(ventasRef, data);
            cerrarModal('modalVenta');
            mostrarAviso('Venta guardada.', 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo guardar. Probá de nuevo.', 'error');
        }
    });
};

window.guardarGasto = async function(e) {
    e.preventDefault();
    await conBotonBloqueado(e, async () => {
        const monto = document.getElementById('gasto-monto').value;
        const desc = document.getElementById('gasto-desc').value;
        const proveedor = document.getElementById('gasto-proveedor').value;
        const metodo = document.getElementById('gasto-metodo').value;
        const comprobante = document.getElementById('gasto-comprobante-base64').value;

        try {
            const gastosRef = coleccion('gastos');
            const data = { monto: Number(monto), descripcion: desc, metodo: metodo, timestamp: obtenerFechaTransaccion() };
            if(proveedor) data.proveedor = proveedor;
            if(comprobante) data.comprobante = comprobante;

            await crearDoc(gastosRef, data);
            cerrarModal('modalGasto');
            mostrarAviso('Gasto registrado correctamente.', 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo guardar. Probá de nuevo.', 'error');
        }
    });
};

window.abrirEditarVenta = function(id) {
    const venta = ventasData.find(v => v.id === id);
    if(!venta) return;
    document.getElementById('edit-venta-id').value = id;
    document.getElementById('edit-venta-monto').value = venta.monto;
    document.getElementById('edit-venta-desc').value = venta.descripcion || 'Venta General';
    abrirModal('modalEditarVenta');
};

window.actualizarVenta = async function(e) {
    e.preventDefault();
    await conBotonBloqueado(e, async () => {
        const id = document.getElementById('edit-venta-id').value;
        try {
            await actualizarDoc(documento('ventas', id), {
                monto: Number(document.getElementById('edit-venta-monto').value),
                descripcion: document.getElementById('edit-venta-desc').value.trim()
            });
            cerrarModal('modalEditarVenta');
            mostrarAviso('Venta actualizada.', 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo actualizar. Probá de nuevo.', 'error');
        }
    });
};

window.abrirEditarGasto = function(id) {
    const gasto = gastosData.find(g => g.id === id);
    if(!gasto) return;
    document.getElementById('edit-gasto-id').value = id;
    document.getElementById('edit-gasto-monto').value = gasto.monto;
    document.getElementById('edit-gasto-desc').value = gasto.descripcion;
    const select = document.getElementById('edit-gasto-proveedor');
    select.innerHTML = `<option value="">Sin Especificar / Otro</option>` + proveedoresData.map(p => `<option value="${escaparHtml(p.nombre)}">${escaparHtml(p.nombre)}</option>`).join('');
    select.value = esHuerfano(gasto) ? '' : gasto.proveedor;
    abrirModal('modalEditarGasto');
};

window.actualizarGasto = async function(e) {
    e.preventDefault();
    await conBotonBloqueado(e, async () => {
        const id = document.getElementById('edit-gasto-id').value;
        try {
            await actualizarDoc(documento('gastos', id), {
                monto: Number(document.getElementById('edit-gasto-monto').value),
                descripcion: document.getElementById('edit-gasto-desc').value.trim(),
                proveedor: document.getElementById('edit-gasto-proveedor').value
            });
            cerrarModal('modalEditarGasto');
            mostrarAviso('Gasto actualizado.', 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo actualizar. Probá de nuevo.', 'error');
        }
    });
};

// ---------- Papelera (solo admin) ----------
const abrirConfirmacion = (modalId) => {
    const modal = document.getElementById(modalId);
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        document.getElementById(`${modalId}Content`).classList.remove('scale-95');
    }, 10);
};
const cerrarConfirmacion = (modalId, alTerminar) => {
    const modal = document.getElementById(modalId);
    modal.classList.add('opacity-0');
    document.getElementById(`${modalId}Content`).classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        alTerminar();
    }, 300);
};

window.confirmarEliminarTransaccion = function(tipo) {
    if (!esAdmin) return;
    transaccionAEliminar = { id: document.getElementById(`edit-${tipo}-id`).value, tipo };
    abrirConfirmacion('modalConfirmDeleteTransaccion');
};

window.cerrarConfirmDeleteTransaccion = function() {
    cerrarConfirmacion('modalConfirmDeleteTransaccion', () => { transaccionAEliminar = { id: null, tipo: null }; });
};

window.eliminarTransaccion = async function() {
    const { id, tipo } = transaccionAEliminar;
    if (!esAdmin || !id) return;
    await conBotonBloqueadoClick(document.getElementById('btn-confirm-delete-transaccion'), async () => {
        try {
            await actualizarDoc(documento(tipo === 'venta' ? 'ventas' : 'gastos', id), { eliminado: true });
            cerrarConfirmDeleteTransaccion();
            cerrarModal(tipo === 'venta' ? 'modalEditarVenta' : 'modalEditarGasto');
            mostrarAviso('Movido a la papelera. Lo podés restaurar desde el Historial.', 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo eliminar. Probá de nuevo.', 'error');
        }
    });
};

window.restaurarTransaccion = async function(boton, id, tipo) {
    if (!esAdmin) return;
    await conBotonBloqueadoClick(boton, async () => {
        try {
            await actualizarDoc(documento(tipo === 'venta' ? 'ventas' : 'gastos', id), { eliminado: false });
            mostrarAviso('Movimiento restaurado.', 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo restaurar. Probá de nuevo.', 'error');
        }
    });
};

// ---------- Proveedores ----------
window.guardarProveedor = async function(e) {
    e.preventDefault();
    await conBotonBloqueado(e, async () => {
        const nombre = document.getElementById('prov-nombre').value.trim();
        if (proveedoresData.some(p => p.nombre.toLowerCase() === nombre.toLowerCase())) { mostrarAviso('Ya existe un proveedor con ese nombre.', 'error'); return; }
        const telefono = document.getElementById('prov-telefono').value.trim();
        const detalle = document.getElementById('prov-detalle').value.trim();
        try {
            const data = { nombre, timestamp: new Date() };
            if(telefono) data.telefono = telefono;
            if(detalle) data.detalle = detalle;
            await crearDoc(coleccion('proveedores'), data);
            cerrarModal('modalProveedor');
            mostrarAviso('Proveedor guardado.', 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo guardar. Probá de nuevo.', 'error');
        }
    });
};

window.abrirEditarProveedor = function(id) {
    const prov = proveedoresData.find(p => p.id === id);
    if(!prov) return;
    document.getElementById('edit-prov-id').value = id;
    document.getElementById('edit-prov-nombre').value = prov.nombre;
    document.getElementById('edit-prov-telefono').value = prov.telefono || '';
    document.getElementById('edit-prov-detalle').value = prov.detalle || '';
    abrirModal('modalEditarProveedor');
};

window.actualizarProveedor = async function(e) {
    e.preventDefault();
    await conBotonBloqueado(e, async () => {
        const id = document.getElementById('edit-prov-id').value;
        const anterior = proveedoresData.find(p => p.id === id);
        const nombre = document.getElementById('edit-prov-nombre').value.trim();
        if (proveedoresData.some(p => p.id !== id && p.nombre.toLowerCase() === nombre.toLowerCase())) { mostrarAviso('Ya existe un proveedor con ese nombre.', 'error'); return; }
        try {
            await actualizarDoc(documento('proveedores', id), {
                nombre,
                telefono: document.getElementById('edit-prov-telefono').value.trim(),
                detalle: document.getElementById('edit-prov-detalle').value.trim()
            });
            // si cambió el nombre, sus gastos lo siguen (se vinculan por nombre)
            if (anterior && anterior.nombre !== nombre) {
                const suyos = [...gastosData, ...gastosEliminados].filter(g => g.proveedor === anterior.nombre);
                await Promise.all(suyos.map(g => actualizarDoc(documento('gastos', g.id), { proveedor: nombre })));
            }
            cerrarModal('modalEditarProveedor');
            mostrarAviso('Proveedor actualizado.', 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo actualizar. Probá de nuevo.', 'error');
        }
    });
};

window.confirmarEliminarProveedor = function() {
    if (!esAdmin) return;
    proveedorAEliminar = document.getElementById('edit-prov-id').value;
    abrirConfirmacion('modalConfirmDelete');
};

window.cerrarConfirmDelete = function() {
    cerrarConfirmacion('modalConfirmDelete', () => { proveedorAEliminar = null; });
};

window.eliminarProveedor = async function() {
    if (!esAdmin || !proveedorAEliminar) return;
    await conBotonBloqueadoClick(document.getElementById('btn-confirm-delete'), async () => {
        try {
            await borrarDoc(documento('proveedores', proveedorAEliminar));
            cerrarConfirmDelete();
            cerrarModal('modalEditarProveedor');
            mostrarAviso('Proveedor eliminado.', 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo eliminar. Probá de nuevo.', 'error');
        }
    });
};

window.guardarProducto = async function(e) {
    e.preventDefault();
    await conBotonBloqueado(e, async () => {
        const nombre = document.getElementById('producto-nombre').value;
        const precio = document.getElementById('producto-precio').value;
        const foto = document.getElementById('producto-comprobante-base64').value;

        try {
            const productosRef = coleccion('productos');
            const data = { nombre: nombre, precio: Number(precio), timestamp: new Date() };
            if(foto) data.foto = foto;

            await crearDoc(productosRef, data);
            cerrarModal('modalProducto');
            mostrarAviso('Producto agregado al catálogo.', 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo guardar. Probá de nuevo.', 'error');
        }
    });
};

window.abrirEditarProducto = function(id) {
    const prod = productosData.find(p => p.id === id);
    if(!prod) return;

    document.getElementById('edit-producto-id').value = id;
    document.getElementById('edit-producto-nombre').value = prod.nombre;
    document.getElementById('edit-producto-precio').value = prod.precio;

    if(prod.foto) {
        document.getElementById('edit-producto-comprobante-base64').value = prod.foto;
        document.getElementById('edit-producto-comprobante-label').innerText = "Foto guardada ✓";
        const labelParent = document.getElementById('edit-producto-comprobante-label').parentElement;
        labelParent.classList.add('border-pipon-orange', 'bg-pipon-yellow', 'text-pipon-brown');
        document.getElementById('edit-producto-comprobante-clear').classList.remove('hidden');
    } else {
        limpiarImagen('edit-producto');
    }

    abrirModal('modalEditarProducto');
};

window.actualizarProducto = async function(e) {
    e.preventDefault();
    await conBotonBloqueado(e, async () => {
        const id = document.getElementById('edit-producto-id').value;
        const nombre = document.getElementById('edit-producto-nombre').value;
        const precio = document.getElementById('edit-producto-precio').value;
        const foto = document.getElementById('edit-producto-comprobante-base64').value;

        try {
            const prodRef = documento('productos', id);
            const data = { nombre: nombre, precio: Number(precio) };

            if(foto) data.foto = foto;
            else data.foto = "";

            await actualizarDoc(prodRef, data);
            cerrarModal('modalEditarProducto');
            mostrarAviso('Producto actualizado.', 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo actualizar. Probá de nuevo.', 'error');
        }
    });
};

window.procesarImagen = function(tipo, inputElement) {
    const file = inputElement.files[0];
    if (!file) return;
    if (file.size > 800 * 1024) { mostrarAviso("Imagen muy pesada.", 'error'); inputElement.value = ""; return; }
    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById(`${tipo}-comprobante-base64`).value = e.target.result;
        const labelStr = (tipo === 'producto' || tipo === 'edit-producto') ? 'Foto lista ✓' : 'Imagen adjunta ✓';
        document.getElementById(`${tipo}-comprobante-label`).innerText = labelStr;

        const labelParent = document.getElementById(`${tipo}-comprobante-label`).parentElement;
        if(tipo === 'producto' || tipo === 'edit-producto') {
            labelParent.classList.add('border-pipon-orange', 'bg-pipon-yellow', 'text-pipon-brown');
        } else {
            labelParent.classList.add('border-green-500', 'bg-green-50', 'text-green-600');
        }
        document.getElementById(`${tipo}-comprobante-clear`).classList.remove('hidden');
    };
    reader.readAsDataURL(file);
};

window.limpiarImagen = function(tipo) {
    document.getElementById(`${tipo}-comprobante`).value = "";
    document.getElementById(`${tipo}-comprobante-base64`).value = "";

    let labelStr = 'Adjuntar foto/captura';
    if (tipo === 'producto') labelStr = 'Subir foto del producto';
    if (tipo === 'edit-producto') labelStr = 'Cambiar foto';

    document.getElementById(`${tipo}-comprobante-label`).innerText = labelStr;
    const labelParent = document.getElementById(`${tipo}-comprobante-label`).parentElement;

    if(tipo === 'producto' || tipo === 'edit-producto') {
        labelParent.classList.remove('border-pipon-orange', 'bg-pipon-yellow', 'text-pipon-brown');
    } else {
        labelParent.classList.remove('border-green-500', 'bg-green-50', 'text-green-600');
    }
    document.getElementById(`${tipo}-comprobante-clear`).classList.add('hidden');
};

window.verComprobante = function(id, coleccion) {
    let dataArr = coleccion === 'ventas' ? ventasData : gastosData;
    let item = dataArr.find(i => i.id === id);
    if(item && item.comprobante) {
        const modal = document.getElementById('modalComprobante');
        document.getElementById('imagen-comprobante-vista').src = item.comprobante;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }
};

window.cerrarComprobante = function() {
    const modal = document.getElementById('modalComprobante');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    setTimeout(() => { document.getElementById('imagen-comprobante-vista').src = ""; }, 300);
};

const ESTADOS_PEDIDO = {
    pendiente:   { texto: 'Pendiente',      clases: 'bg-amber-100 text-amber-700', icono: 'fa-inbox' },
    preparacion: { texto: 'En preparación', clases: 'bg-blue-100 text-blue-700',   icono: 'fa-fire-burner' },
    listo:       { texto: 'Listo',          clases: 'bg-green-100 text-green-700', icono: 'fa-circle-check' },
    entregado:   { texto: 'Entregado',      clases: 'bg-gray-100 text-gray-600',   icono: 'fa-handshake' },
    cancelado:   { texto: 'Cancelado',      clases: 'bg-red-100 text-red-600',     icono: 'fa-ban' }
};
const ESTADOS_ACTIVOS = ['pendiente', 'preparacion', 'listo'];
const DESCUENTOS = [0, 5, 10, 15];

let subPestanaMayorista = 'pedidos';
let gruposHistorialMayorista = {};
let productosFormPedido = [];
let cantidadesPedido = {};
let pedidoDetalleAbierto = null;
let historialContactoAbierto = null;
let guardandoPedido = false;


// wa.me necesita 549 + característica + número
const normalizarTelefono = (tel) => {
    let n = String(tel || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!n) return '';
    if (n.startsWith('549')) return n;
    if (n.startsWith('54')) return '549' + n.slice(2);
    return '549' + n;
};
const linkWhatsApp = (tel, texto = '') => {
    const n = normalizarTelefono(tel);
    if (!n) return '';
    return `https://wa.me/${n}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;
};
const linkPedido = (contactoId = null) => {
    const url = new URL('pedido.html', location.href);
    url.search = '';
    if (contactoId) url.searchParams.set('c', contactoId);
    if (MODO_PRUEBA) url.searchParams.set('prueba', '1');
    return url.toString();
};

const calcularTotalesPedido = (items, descuento) => {
    const unidades = items.reduce((s, it) => s + Number(it.cantidad), 0);
    const subtotal = items.reduce((s, it) => s + Number(it.cantidad) * Number(it.precio), 0);
    const pct = Number(descuento) || 0;
    const montoDescuento = Math.round(subtotal * pct / 100);
    return { unidades, subtotal, descuento: pct, montoDescuento, total: subtotal - montoDescuento };
};

// los pedidos del link general no traen id, se buscan por teléfono
const contactoDePedido = (p) => {
    const porId = p.mayoristaId && mayoristasData.find(m => m.id === p.mayoristaId);
    if (porId) return porId;
    const tel = normalizarTelefono(p.mayoristaTelefono);
    return tel ? mayoristasData.find(m => normalizarTelefono(m.telefono) === tel) || null : null;
};
const claveContactoPedido = (p) => contactoDePedido(p)?.id || `sin:${normalizarTelefono(p.mayoristaTelefono) || p.mayoristaNombre || p.id}`;
const nombrePedido = (p) => contactoDePedido(p)?.nombre || p.mayoristaNombre || 'Sin nombre';
const telefonoPedido = (p) => contactoDePedido(p)?.telefono || p.mayoristaTelefono || '';

const estadisticasContacto = (m) => {
    const pedidos = pedidosData.filter(p => p.estado !== 'cancelado' && contactoDePedido(p)?.id === m.id);
    const ultima = pedidos.reduce((max, p) => {
        const f = aFecha(p.timestamp);
        return f && (!max || f > max) ? f : max;
    }, null);
    const referencia = ultima || aFecha(m.creado);
    const dias = referencia ? diasEntre(referencia, new Date()) : 0;
    const alerta = Number(m.diasAviso) > 0 && dias >= Number(m.diasAviso);
    return { compras: pedidos.length, ultima, dias, alerta };
};

const chipEstado = (estado) => {
    const e = ESTADOS_PEDIDO[estado] || ESTADOS_PEDIDO.pendiente;
    return `<span class="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${e.clases}"><i class="fa-solid ${e.icono} mr-1"></i>${e.texto}</span>`;
};
const resumenItemsCorto = (p) => (p.items || []).map(it => `${it.cantidad} ${it.nombre}`).join(' · ');
const resumenItemsTexto = (p) => (p.items || []).map(it => `• ${it.cantidad} x ${it.nombre}`).join('\n');

const mensajePedido = (tipo, p) => {
    const nombre = nombrePedido(p);
    if (tipo === 'preparacion') {
        return `¡Hola ${nombre}! 🥪\nGracias por tu compra. Tu pedido se encuentra realizándose:\n\n${resumenItemsTexto(p)}\n\nTotal: ${formatearDinero(p.total)}\n\nTe avisamos apenas esté listo. ¡Gracias por elegir Pipón!`;
    }
    return `¡Hola ${nombre}! 🎉\n¡Tu pedido ya se encuentra listo!\n\n${resumenItemsTexto(p)}\n\nTotal: ${formatearDinero(p.total)}\n\n¡Gracias por elegir Pipón!`;
};
const mensajeRecordatorio = (m) => `¡Hola ${m.nombre}! 👋 ¿Cómo estás? Te escribimos de Pipón 🥪 para saber si querés hacer un pedido. Podés armarlo acá:\n${linkPedido(m.id)}`;
const mensajeLinkPedido = (m) => `¡Hola ${m.nombre}! 👋 Te compartimos tu link para hacer pedidos mayoristas en Pipón 🥪\n${linkPedido(m.id)}\n\nElegís los productos y cantidades, y el pedido nos llega directo.`;

window.cambiarSubPestana = function(sub) {
    subPestanaMayorista = sub;
    renderMayorista();
};

window.irAMayorista = function(sub) {
    subPestanaMayorista = sub;
    cambiarPestana('mayorista');
};

function renderMayorista() {
    const activos = pedidosData.filter(p => ESTADOS_ACTIVOS.includes(p.estado));
    const alertas = mayoristasData.filter(m => estadisticasContacto(m).alerta).length;

    const subtabs = [
        { id: 'pedidos', texto: 'Pedidos', icono: 'fa-clipboard-list', badge: activos.length, color: 'bg-violet-600' },
        { id: 'historial', texto: 'Historial', icono: 'fa-clock-rotate-left', badge: 0 },
        { id: 'contactos', texto: 'Contactos', icono: 'fa-address-book', badge: alertas, color: 'bg-red-500' }
    ];
    document.getElementById('subtabs-mayorista').innerHTML = subtabs.map(s => {
        const activa = subPestanaMayorista === s.id;
        const badge = s.badge ? `<span class="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] flex items-center justify-center ${activa ? 'bg-white text-violet-700' : s.color + ' text-white'}">${s.badge}</span>` : '';
        return `<button onclick="cambiarSubPestana('${s.id}')" class="py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${activa ? 'bg-violet-600 text-white shadow-sm' : 'text-gray-500'}"><i class="fa-solid ${s.icono}"></i>${s.texto}${badge}</button>`;
    }).join('');

    document.querySelectorAll('.subtab-mayorista').forEach(el => el.classList.add('hidden'));
    document.getElementById(`mayorista-${subPestanaMayorista}`).classList.remove('hidden');

    renderPedidosMayorista(activos);
    renderHistorialMayorista();
    renderContactosMayorista();
}

function renderPedidosMayorista(activos) {
    const cont = document.getElementById('mayorista-pedidos');
    if (!activos.length) {
        cont.innerHTML = `<div class="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm"><i class="fa-solid fa-clipboard-check text-4xl text-gray-200 mb-3 block"></i><p class="text-gray-500 font-medium">No hay pedidos por realizar.</p></div>`;
        return;
    }
    const orden = { pendiente: 0, preparacion: 1, listo: 2 };
    activos.sort((a, b) => orden[a.estado] - orden[b.estado] || (aFecha(a.timestamp)?.getTime() || 0) - (aFecha(b.timestamp)?.getTime() || 0));

    const aPreparar = {};
    activos.filter(p => p.estado !== 'listo').forEach(p => (p.items || []).forEach(it => {
        aPreparar[it.nombre] = (aPreparar[it.nombre] || 0) + Number(it.cantidad);
    }));
    const filas = Object.entries(aPreparar).sort((a, b) => b[1] - a[1]);

    let html = '';
    if (filas.length) {
        html += `
            <div class="bg-white rounded-2xl p-4 shadow-sm border border-violet-100 mb-4 relative overflow-hidden">
                <div class="absolute top-0 left-0 w-full h-1 bg-violet-500"></div>
                <h3 class="font-bold text-gray-800 text-sm mb-3 flex items-center gap-2"><i class="fa-solid fa-kitchen-set text-violet-500"></i> Total a preparar</h3>
                <div class="flex flex-col gap-1.5">
                    ${filas.map(([nombre, cant]) => `<div class="flex justify-between text-sm"><span class="text-gray-600 font-medium">${escaparHtml(nombre)}</span><span class="font-black text-violet-700">${cant} u.</span></div>`).join('')}
                </div>
            </div>`;
    }
    html += `<div class="flex flex-col gap-3 pb-8">${activos.map(p => `
        <button onclick="verDetallePedido('${p.id}')" class="w-full text-left bg-white rounded-xl p-4 shadow-sm border-l-4 border-l-violet-500 active:bg-gray-50 transition-colors">
            <div class="flex justify-between items-start gap-3">
                <div class="min-w-0">
                    <p class="font-bold text-gray-800 truncate">${escaparHtml(nombrePedido(p))}</p>
                    <p class="text-xs text-gray-400 mt-0.5"><i class="fa-regular fa-clock"></i> ${formatearFechaHora(p.timestamp)}${p.origen === 'link' ? ' · <i class="fa-solid fa-link"></i> vía link' : ''}</p>
                    <p class="text-xs text-gray-500 mt-1 truncate">${escaparHtml(resumenItemsCorto(p))}</p>
                </div>
                <div class="text-right shrink-0">
                    ${chipEstado(p.estado)}
                    <p class="font-black text-violet-700 text-lg mt-1">${formatearDinero(p.total)}</p>
                    <p class="text-[11px] text-gray-400 font-bold">${p.unidades} u.</p>
                </div>
            </div>
        </button>`).join('')}</div>`;
    cont.innerHTML = html;
}

function renderHistorialMayorista() {
    const cont = document.getElementById('mayorista-historial');
    const grupos = {};
    pedidosData.filter(p => p.estado !== 'cancelado').forEach(p => {
        const clave = claveContactoPedido(p);
        (grupos[clave] ||= { clave, nombre: nombrePedido(p), pedidos: [] }).pedidos.push(p);
    });
    gruposHistorialMayorista = grupos;

    const lista = Object.values(grupos).map(g => ({
        ...g,
        ultima: g.pedidos.reduce((max, p) => Math.max(max, aFecha(p.timestamp)?.getTime() || 0), 0),
        unidades: g.pedidos.reduce((s, p) => s + (Number(p.unidades) || 0), 0),
        total: g.pedidos.reduce((s, p) => s + (Number(p.total) || 0), 0)
    })).sort((a, b) => b.ultima - a.ultima);

    if (!lista.length) {
        cont.innerHTML = `<div class="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm"><i class="fa-solid fa-clock-rotate-left text-4xl text-gray-200 mb-3 block"></i><p class="text-gray-500 font-medium">Todavía no hay compras mayoristas.</p></div>`;
        return;
    }
    cont.innerHTML = `<div class="flex flex-col gap-3 pb-8">${lista.map(g => `
        <button data-clave="${escaparHtml(g.clave)}" onclick="verHistorialContacto(this.dataset.clave)" class="w-full text-left bg-white rounded-xl p-4 shadow-sm border border-gray-100 active:bg-gray-50 transition-colors flex justify-between items-center gap-3">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-10 h-10 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center font-black shrink-0">${escaparHtml(g.nombre.charAt(0).toUpperCase())}</div>
                <div class="min-w-0">
                    <p class="font-bold text-gray-800 truncate">${escaparHtml(g.nombre)}</p>
                    <p class="text-[11px] text-gray-500 font-medium">${plural(g.pedidos.length, 'compra', 'compras')} · ${g.unidades} u. · Última: ${formatearFecha(new Date(g.ultima))}</p>
                </div>
            </div>
            <div class="text-right shrink-0">
                <p class="font-black text-violet-700">${formatearDinero(g.total)}</p>
                <i class="fa-solid fa-chevron-right text-gray-300 text-xs"></i>
            </div>
        </button>`).join('')}</div>`;
}

function renderContactosMayorista() {
    const cont = document.getElementById('mayorista-contactos');
    const encabezado = `
        <div class="grid grid-cols-2 gap-2 mb-4">
            <button onclick="abrirContacto()" class="bg-violet-600 text-white font-bold py-3 rounded-xl text-sm shadow-sm active:scale-95 transition-all"><i class="fa-solid fa-user-plus mr-1.5"></i>Nuevo contacto</button>
            <button onclick="copiarLinkPedido()" class="bg-white border border-violet-200 text-violet-700 font-bold py-3 rounded-xl text-sm active:scale-95 transition-all"><i class="fa-solid fa-link mr-1.5"></i>Link general</button>
        </div>`;

    if (!mayoristasData.length) {
        cont.innerHTML = encabezado + `<div class="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm"><i class="fa-solid fa-address-book text-4xl text-gray-200 mb-3 block"></i><p class="text-gray-500 font-medium">Todavía no cargaste contactos mayoristas.</p></div>`;
        return;
    }

    const lista = mayoristasData.map(m => ({ m, est: estadisticasContacto(m) }))
        .sort((a, b) => (b.est.alerta - a.est.alerta) || a.m.nombre.localeCompare(b.m.nombre));

    cont.innerHTML = encabezado + `<div class="flex flex-col gap-3 pb-8">${lista.map(({ m, est }) => {
        const wa = linkWhatsApp(m.telefono);
        return `
        <div class="rounded-2xl p-4 shadow-sm border ${est.alerta ? 'border-red-300 bg-red-50/50' : 'border-gray-100 bg-white'}">
            <div class="flex justify-between items-start gap-3">
                <button onclick="abrirContacto('${m.id}')" class="text-left min-w-0">
                    <p class="font-bold text-gray-800 truncate">${escaparHtml(m.nombre)} ${m.descuento ? `<span class="text-[10px] bg-violet-100 text-violet-700 font-black px-1.5 py-0.5 rounded align-middle">-${m.descuento}%</span>` : ''}</p>
                    <p class="text-xs text-gray-400 font-medium">${escaparHtml(m.telefono || 'Sin WhatsApp')}</p>
                </button>
                ${wa ? `<a href="${wa}" target="_blank" class="w-10 h-10 bg-green-500 text-white rounded-full flex items-center justify-center text-xl shrink-0 shadow-sm active:scale-95 transition-transform"><i class="fa-brands fa-whatsapp"></i></a>` : ''}
            </div>
            <div class="grid grid-cols-3 gap-2 mt-3 text-center">
                <div class="bg-gray-50 rounded-lg p-2">
                    <p class="text-lg font-black text-gray-800">${est.compras}</p>
                    <p class="text-[9px] uppercase font-bold text-gray-400 leading-tight">Compras</p>
                </div>
                <div class="${est.alerta ? 'bg-red-100' : 'bg-gray-50'} rounded-lg p-2">
                    <p class="text-lg font-black ${est.alerta ? 'text-red-600' : 'text-gray-800'}">${est.dias}</p>
                    <p class="text-[9px] uppercase font-bold ${est.alerta ? 'text-red-500' : 'text-gray-400'} leading-tight">${est.ultima ? 'Días sin comprar' : 'Días sin 1ª compra'}</p>
                </div>
                <button onclick="abrirContacto('${m.id}')" class="bg-gray-50 rounded-lg p-2">
                    <p class="text-lg font-black text-gray-800">${m.diasAviso || '—'}</p>
                    <p class="text-[9px] uppercase font-bold text-gray-400 leading-tight">Avisar a los (días)</p>
                </button>
            </div>
            ${est.alerta && wa ? `<a href="${linkWhatsApp(m.telefono, mensajeRecordatorio(m))}" target="_blank" class="mt-3 flex items-center justify-center gap-2 bg-red-500 text-white font-bold py-2.5 rounded-xl text-sm active:scale-95 transition-all"><i class="fa-brands fa-whatsapp"></i> Pasaron ${est.dias} días · Escribirle</a>` : ''}
            ${est.alerta && !wa ? `<p class="mt-3 text-center text-xs font-bold text-red-500">Pasaron ${est.dias} días sin comprar (cargale un WhatsApp para escribirle)</p>` : ''}
        </div>`;
    }).join('')}</div>`;
}

function renderAlertasInicio() {
    const cont = document.getElementById('alertas-mayorista');
    const nuevos = pedidosData.filter(p => p.estado === 'pendiente').length;
    const inactivos = mayoristasData.filter(m => estadisticasContacto(m).alerta);
    const totalAvisos = nuevos + inactivos.length;

    const badge = document.getElementById('badge-mayorista');
    badge.innerText = totalAvisos;
    badge.classList.toggle('hidden', totalAvisos === 0);
    badge.classList.toggle('flex', totalAvisos > 0);

    let html = '';
    if (nuevos) {
        html += `<button onclick="irAMayorista('pedidos')" class="w-full text-left bg-violet-600 text-white rounded-2xl p-4 flex items-center gap-3 shadow-md active:scale-95 transition-all">
            <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0"><i class="fa-solid fa-inbox"></i></div>
            <div class="flex-1"><p class="font-bold">${plural(nuevos, 'pedido mayorista nuevo', 'pedidos mayoristas nuevos')}</p><p class="text-xs text-white/80">Tocá para verlos y empezar a prepararlos</p></div>
            <i class="fa-solid fa-chevron-right text-white/70"></i>
        </button>`;
    }
    if (inactivos.length) {
        html += `<button onclick="irAMayorista('contactos')" class="w-full text-left bg-red-500 text-white rounded-2xl p-4 flex items-center gap-3 shadow-md active:scale-95 transition-all">
            <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0"><i class="fa-solid fa-bell"></i></div>
            <div class="flex-1 min-w-0"><p class="font-bold">${plural(inactivos.length, 'mayorista sin comprar', 'mayoristas sin comprar')}</p><p class="text-xs text-white/80 truncate">${escaparHtml(inactivos.map(m => m.nombre).join(', '))}</p></div>
            <i class="fa-solid fa-chevron-right text-white/70"></i>
        </button>`;
    }
    cont.innerHTML = html;
    cont.classList.toggle('hidden', !html);
    cont.classList.toggle('flex', !!html);
}

window.elegirDescuento = function(prefijo, valor) {
    document.getElementById(`${prefijo}-descuento`).value = valor;
    document.querySelectorAll(`.desc-btn-${prefijo}`).forEach(btn => {
        const activo = Number(btn.dataset.valor) === Number(valor);
        btn.className = `desc-btn-${prefijo} border-2 font-bold py-2.5 rounded-xl text-sm transition-all ${activo ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 text-gray-500'}`;
    });
    if (prefijo === 'pedido') renderResumenPedido();
};

function inicializarBotonesDescuento() {
    ['pedido', 'contacto'].forEach(prefijo => {
        document.getElementById(`${prefijo}-descuento-btns`).innerHTML = DESCUENTOS.map(d =>
            `<button type="button" data-valor="${d}" onclick="elegirDescuento('${prefijo}', ${d})" class="desc-btn-${prefijo}">${d ? d + '%' : 'Sin desc.'}</button>`
        ).join('');
        elegirDescuento(prefijo, 0);
    });
}

window.abrirVenta = function(tipo = 'minorista') {
    document.getElementById('pedido-edit-id').value = '';
    seleccionarTipoVenta(tipo);
    abrirModal('modalVenta');
};

window.seleccionarTipoVenta = function(tipo) {
    const esMayorista = tipo === 'mayorista';
    const editando = !!document.getElementById('pedido-edit-id').value;
    document.getElementById('form-venta').classList.toggle('hidden', esMayorista);
    document.getElementById('form-pedido').classList.toggle('hidden', !esMayorista);
    document.getElementById('selector-tipo-venta').classList.toggle('hidden', editando);

    const titulo = document.getElementById('titulo-modal-venta');
    titulo.innerText = editando ? 'Editar Pedido' : (esMayorista ? 'Pedido Mayorista' : 'Registrar Venta');
    titulo.className = `text-2xl font-black ${esMayorista ? 'text-violet-600' : 'text-green-600'}`;

    const base = 'py-2.5 rounded-xl font-bold text-sm transition-all';
    document.getElementById('tipo-btn-minorista').className = `${base} ${!esMayorista ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500'}`;
    document.getElementById('tipo-btn-mayorista').className = `${base} ${esMayorista ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-500'}`;
    document.getElementById('pedido-submit').innerText = editando ? 'Guardar Cambios' : 'Crear Pedido';

    if (esMayorista && !editando) prepararFormPedido(null);
};

function prepararFormPedido(pedido) {
    cantidadesPedido = {};
    productosFormPedido = productosData.map(p => ({ id: p.id, nombre: p.nombre, precio: Number(p.precio), foto: p.foto }));
    if (pedido) {
        (pedido.items || []).forEach(it => {
            const clave = it.productoId || `item:${it.nombre}`;
            const existente = productosFormPedido.find(p => p.id === clave);
            if (existente) existente.precio = Number(it.precio);
            else productosFormPedido.push({ id: clave, nombre: it.nombre, precio: Number(it.precio) });
            cantidadesPedido[clave] = Number(it.cantidad);
        });
    }

    const contacto = pedido ? contactoDePedido(pedido) : null;
    renderOpcionesContactoPedido(pedido ? (contacto ? contacto.id : '__nuevo__') : '');
    document.getElementById('pedido-nuevo-nombre').value = pedido && !contacto ? (pedido.mayoristaNombre || '') : '';
    document.getElementById('pedido-nuevo-telefono').value = pedido && !contacto ? (pedido.mayoristaTelefono || '') : '';
    document.getElementById('pedido-notas').value = pedido?.notas || '';
    elegirDescuento('pedido', pedido ? (pedido.descuento || 0) : 0);
    renderProductosPedido();
}

function renderOpcionesContactoPedido(valor) {
    const select = document.getElementById('pedido-contacto');
    const ordenados = [...mayoristasData].sort((a, b) => a.nombre.localeCompare(b.nombre));
    select.innerHTML = `<option value="">Elegí un contacto...</option>`
        + ordenados.map(m => `<option value="${m.id}">${escaparHtml(m.nombre)}${m.descuento ? ` (-${m.descuento}%)` : ''}</option>`).join('')
        + `<option value="__nuevo__">➕ Nuevo contacto</option>`;
    select.value = valor || '';
    mostrarNuevoContactoPedido();
}

function mostrarNuevoContactoPedido() {
    const esNuevo = document.getElementById('pedido-contacto').value === '__nuevo__';
    const box = document.getElementById('pedido-nuevo-contacto');
    box.classList.toggle('hidden', !esNuevo);
    box.classList.toggle('flex', esNuevo);
}

window.seleccionarContactoPedido = function() {
    mostrarNuevoContactoPedido();
    const m = mayoristasData.find(x => x.id === document.getElementById('pedido-contacto').value);
    elegirDescuento('pedido', m ? (m.descuento || 0) : 0);
};

function renderProductosPedido() {
    const cont = document.getElementById('pedido-productos');
    if (!productosFormPedido.length) {
        cont.innerHTML = `<p class="text-sm text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-xl">Primero cargá productos en el Catálogo.</p>`;
    } else {
        cont.innerHTML = productosFormPedido.map(p => {
            const cant = cantidadesPedido[p.id] || 0;
            return `
            <div class="flex items-center gap-3 rounded-xl p-2 pr-2.5 border transition-colors ${cant ? 'bg-violet-50 border-violet-300' : 'bg-gray-50 border-gray-100'}">
                <div class="w-10 h-10 rounded-full bg-white overflow-hidden flex items-center justify-center border border-gray-100 shrink-0">
                    ${p.foto ? `<img src="${p.foto}" class="w-full h-full object-cover">` : `<i class="fa-solid fa-box text-gray-300"></i>`}
                </div>
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-gray-800 text-sm truncate">${escaparHtml(p.nombre)}</p>
                    <p class="text-xs text-gray-400 font-medium">${formatearDinero(p.precio)} c/u</p>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button type="button" data-id="${escaparHtml(p.id)}" onclick="cambiarCantidadPedido(this.dataset.id, -1)" class="w-8 h-8 rounded-full bg-white border border-gray-200 text-gray-600 font-black active:scale-90 transition-transform"><i class="fa-solid fa-minus text-xs"></i></button>
                    <input type="number" min="0" inputmode="numeric" value="${cant}" data-id="${escaparHtml(p.id)}" onchange="fijarCantidadPedido(this.dataset.id, this.value)" onfocus="this.select()" class="w-11 text-center font-black text-gray-800 bg-transparent outline-none">
                    <button type="button" data-id="${escaparHtml(p.id)}" onclick="cambiarCantidadPedido(this.dataset.id, 1)" class="w-8 h-8 rounded-full bg-violet-600 text-white font-black active:scale-90 transition-transform"><i class="fa-solid fa-plus text-xs"></i></button>
                </div>
            </div>`;
        }).join('');
    }
    renderResumenPedido();
}

window.cambiarCantidadPedido = function(id, delta) {
    cantidadesPedido[id] = Math.max(0, (cantidadesPedido[id] || 0) + delta);
    renderProductosPedido();
};

window.fijarCantidadPedido = function(id, valor) {
    cantidadesPedido[id] = Math.max(0, parseInt(valor, 10) || 0);
    renderProductosPedido();
};

const itemsFormPedido = () => productosFormPedido
    .filter(p => cantidadesPedido[p.id] > 0)
    .map(p => ({ productoId: p.id.startsWith('item:') ? null : p.id, nombre: p.nombre, cantidad: cantidadesPedido[p.id], precio: Number(p.precio) }));

function renderResumenPedido() {
    const t = calcularTotalesPedido(itemsFormPedido(), document.getElementById('pedido-descuento').value);
    document.getElementById('pedido-resumen').innerHTML = `
        <div class="flex justify-between text-gray-600 mb-1"><span>Unidades</span><span class="font-bold">${t.unidades}</span></div>
        <div class="flex justify-between text-gray-600 mb-1"><span>Subtotal</span><span class="font-bold">${formatearDinero(t.subtotal)}</span></div>
        ${t.descuento ? `<div class="flex justify-between text-violet-600 mb-1"><span>Descuento ${t.descuento}%</span><span class="font-bold">-${formatearDinero(t.montoDescuento)}</span></div>` : ''}
        <div class="flex justify-between items-center border-t border-violet-200 pt-2 mt-2"><span class="font-bold text-gray-800">Total</span><span class="text-2xl font-black text-violet-700">${formatearDinero(t.total)}</span></div>`;
}

window.guardarPedido = async function(e) {
    e.preventDefault();
    if (guardandoPedido) return;
    const items = itemsFormPedido();
    if (!items.length) { mostrarAviso('Agregá al menos un producto.', 'error'); return; }

    const seleccion = document.getElementById('pedido-contacto').value;
    if (!seleccion) { mostrarAviso('Elegí un contacto mayorista.', 'error'); return; }

    const editId = document.getElementById('pedido-edit-id').value;
    guardandoPedido = true;
    try {
        let contacto;
        if (seleccion === '__nuevo__') {
            const nombre = document.getElementById('pedido-nuevo-nombre').value.trim();
            const telefono = document.getElementById('pedido-nuevo-telefono').value.trim();
            if (!nombre) { mostrarAviso('Escribí el nombre del contacto.', 'error'); return; }
            const existente = telefono && mayoristasData.find(m => normalizarTelefono(m.telefono) === normalizarTelefono(telefono));
            if (existente) {
                contacto = existente;
            } else {
                const nuevo = { nombre, telefono, descuento: Number(document.getElementById('pedido-descuento').value) || 0, diasAviso: null, notas: '', creado: new Date() };
                const ref = await crearDoc(coleccion('mayoristas'), nuevo);
                contacto = { id: ref.id, ...nuevo };
            }
        } else {
            contacto = mayoristasData.find(m => m.id === seleccion);
        }

        const data = {
            mayoristaId: contacto.id,
            mayoristaNombre: contacto.nombre,
            mayoristaTelefono: contacto.telefono || '',
            items,
            ...calcularTotalesPedido(items, document.getElementById('pedido-descuento').value),
            notas: document.getElementById('pedido-notas').value.trim()
        };

        if (editId) {
            await actualizarDoc(documento('pedidos', editId), data);
            mostrarAviso('Pedido actualizado.', 'ok');
        } else {
            await crearDoc(coleccion('pedidos'), { ...data, estado: 'pendiente', origen: 'sistema', timestamp: new Date() });
            mostrarAviso('Pedido creado. Lo ves en Mayorista.', 'ok');
        }
        cerrarModal('modalVenta');
    } catch (error) {
        console.error(error);
        mostrarAviso('No se pudo guardar. Probá de nuevo.', 'error');
    } finally {
        guardandoPedido = false;
    }
};

window.verDetallePedido = function(id) {
    pedidoDetalleAbierto = id;
    renderDetallePedido();
    abrirModal('modalPedidoDetalle');
};

function renderDetallePedido() {
    const cont = document.getElementById('pedido-detalle-contenido');
    const p = pedidosData.find(x => x.id === pedidoDetalleAbierto);
    if (!p) { cont.innerHTML = `<p class="text-center text-gray-400 py-8">Pedido no encontrado.</p>`; return; }

    const contacto = contactoDePedido(p);
    const tel = telefonoPedido(p);
    const wa = linkWhatsApp(tel);
    const pasos = [
        ['Pedido recibido', p.timestamp],
        ['En preparación', p.fechaPreparacion],
        ['Listo', p.fechaListo],
        [`Entregado y cobrado${p.metodo ? ' · ' + p.metodo : ''}`, p.fechaEntrega]
    ];
    if (p.estado === 'cancelado') pasos.push(['Cancelado', p.fechaCancelado]);

    const btnSecundario = (onclick, icono, texto, color = 'text-gray-600') =>
        `<button onclick="${onclick}" class="w-full bg-gray-50 border border-gray-100 ${color} font-bold py-3 rounded-xl text-sm active:bg-gray-100"><i class="fa-solid ${icono} mr-2"></i>${texto}</button>`;
    const editarCancelar = `<div class="grid grid-cols-2 gap-2">${btnSecundario(`editarPedido('${p.id}')`, 'fa-pen', 'Editar')}${btnSecundario(`cancelarPedido('${p.id}')`, 'fa-ban', 'Cancelar', 'text-red-500')}</div>`;

    let acciones = '';
    if (p.estado === 'pendiente') {
        acciones = `
            <button onclick="avanzarPedido('${p.id}', 'preparacion', true)" class="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-blue-200 active:scale-95 transition-all"><i class="fa-brands fa-whatsapp mr-2"></i>Avisar: pedido en preparación</button>
            <button onclick="avanzarPedido('${p.id}', 'preparacion', false)" class="w-full text-xs font-bold text-gray-400 py-1">Pasar a preparación sin enviar mensaje</button>
            ${editarCancelar}`;
    } else if (p.estado === 'preparacion') {
        acciones = `
            <button onclick="avanzarPedido('${p.id}', 'listo', true)" class="w-full bg-green-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-green-200 active:scale-95 transition-all"><i class="fa-brands fa-whatsapp mr-2"></i>Confirmar: pedido listo</button>
            <button onclick="avanzarPedido('${p.id}', 'listo', false)" class="w-full text-xs font-bold text-gray-400 py-1">Marcar listo sin enviar mensaje</button>
            ${editarCancelar}`;
    } else if (p.estado === 'listo') {
        acciones = `
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Al entregarlo, ¿cómo se cobró?</p>
            <div class="grid grid-cols-2 gap-2">
                <button onclick="entregarPedido('${p.id}', 'Efectivo')" class="bg-green-500 text-white font-bold py-3.5 rounded-xl active:scale-95 transition-all"><i class="fa-solid fa-money-bill-wave mr-1.5"></i>Efectivo</button>
                <button onclick="entregarPedido('${p.id}', 'Transferencia')" class="bg-green-500 text-white font-bold py-3.5 rounded-xl active:scale-95 transition-all"><i class="fa-solid fa-building-columns mr-1.5"></i>Transfer.</button>
            </div>
            <div class="grid grid-cols-2 gap-2">${btnSecundario(`enviarMensajePedido('${p.id}', 'listo')`, 'fa-rotate-right', 'Reenviar "listo"')}${btnSecundario(`cancelarPedido('${p.id}')`, 'fa-ban', 'Cancelar', 'text-red-500')}</div>`;
    }

    cont.innerHTML = `
        <div class="flex justify-between items-start gap-3 mb-4">
            <div class="min-w-0">
                <p class="text-xl font-black text-gray-800 truncate">${escaparHtml(nombrePedido(p))}</p>
                <p class="text-xs text-gray-400 font-medium mt-0.5">${escaparHtml(tel || 'Sin WhatsApp')}${p.origen === 'link' ? ' · <i class="fa-solid fa-link"></i> vía link' : ''}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                ${chipEstado(p.estado)}
                ${wa ? `<a href="${wa}" target="_blank" class="w-9 h-9 bg-green-500 text-white rounded-full flex items-center justify-center text-lg"><i class="fa-brands fa-whatsapp"></i></a>` : ''}
            </div>
        </div>

        ${!contacto ? `<button onclick="guardarContactoDesdePedido('${p.id}')" class="w-full mb-4 bg-violet-50 border border-dashed border-violet-300 text-violet-700 font-bold py-2.5 rounded-xl text-sm"><i class="fa-solid fa-user-plus mr-1.5"></i>Cliente nuevo · Guardar en contactos</button>` : ''}

        <div class="bg-gray-50 rounded-xl border border-gray-100 p-4 mb-4">
            <div class="flex flex-col gap-2">
                ${(p.items || []).map(it => `
                    <div class="flex justify-between items-center text-sm">
                        <span class="text-gray-700"><span class="font-black text-violet-700">${it.cantidad} ×</span> ${escaparHtml(it.nombre)}</span>
                        <span class="font-bold text-gray-600">${formatearDinero(it.cantidad * it.precio)}</span>
                    </div>`).join('')}
            </div>
            <div class="border-t border-gray-200 mt-3 pt-3 text-sm">
                <div class="flex justify-between text-gray-500"><span>Unidades</span><span class="font-bold">${p.unidades}</span></div>
                <div class="flex justify-between text-gray-500"><span>Subtotal</span><span class="font-bold">${formatearDinero(p.subtotal)}</span></div>
                ${p.descuento ? `<div class="flex justify-between text-violet-600"><span>Descuento ${p.descuento}%</span><span class="font-bold">-${formatearDinero(p.montoDescuento)}</span></div>` : ''}
                <div class="flex justify-between items-center mt-1"><span class="font-bold text-gray-800">Total</span><span class="text-2xl font-black text-violet-700">${formatearDinero(p.total)}</span></div>
            </div>
        </div>

        ${p.notas ? `<div class="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-4 text-sm text-amber-900"><i class="fa-regular fa-note-sticky mr-1.5"></i>${escaparHtml(p.notas)}</div>` : ''}

        <div class="flex flex-col gap-1.5 mb-5 px-1">
            ${pasos.map(([texto, fecha]) => `
                <div class="flex items-center gap-2 text-xs ${fecha ? 'text-gray-700' : 'text-gray-300'}">
                    <i class="fa-solid ${fecha ? 'fa-circle-check text-violet-500' : 'fa-circle'} text-[10px]"></i>
                    <span class="font-bold">${escaparHtml(texto)}</span>
                    <span class="ml-auto font-medium">${fecha ? formatearFechaHora(fecha) : '—'}</span>
                </div>`).join('')}
        </div>

        <div class="flex flex-col gap-2">${acciones}</div>`;
}

window.enviarMensajePedido = function(id, tipo) {
    const p = pedidosData.find(x => x.id === id);
    if (!p) return false;
    const url = linkWhatsApp(telefonoPedido(p), mensajePedido(tipo, p));
    if (!url) { mostrarAviso('El contacto no tiene WhatsApp cargado.', 'error'); return false; }
    window.open(url, '_blank');
    return true;
};

window.avanzarPedido = async function(id, nuevoEstado, conMensaje) {
    // El mensaje se abre antes del await para que el navegador no bloquee la ventana de WhatsApp
    if (conMensaje) enviarMensajePedido(id, nuevoEstado);
    const campos = { estado: nuevoEstado };
    if (nuevoEstado === 'preparacion') campos.fechaPreparacion = new Date();
    if (nuevoEstado === 'listo') campos.fechaListo = new Date();
    try {
        await actualizarDoc(documento('pedidos', id), campos);
        mostrarAviso(nuevoEstado === 'listo' ? '¡Pedido listo!' : 'Pedido en preparación.', 'ok');
    } catch (error) {
        console.error(error);
        mostrarAviso('No se pudo actualizar. Probá de nuevo.', 'error');
    }
};

window.entregarPedido = async function(id, metodo) {
    const p = pedidosData.find(x => x.id === id);
    if (!p || !confirm(`¿Confirmás que el pedido se entregó y se cobró ${formatearDinero(p.total)} por ${metodo}?\nSe va a sumar al balance de hoy.`)) return;
    try {
        await actualizarDoc(documento('pedidos', id), { estado: 'entregado', fechaEntrega: new Date(), metodo });
        cerrarModal('modalPedidoDetalle');
        mostrarAviso('Pedido cobrado. Ya suma al balance.', 'ok');
    } catch (error) {
        console.error(error);
        mostrarAviso('No se pudo actualizar. Probá de nuevo.', 'error');
    }
};

window.cancelarPedido = async function(id) {
    if (!confirm('¿Cancelar este pedido? No se va a contar en ningún balance.')) return;
    try {
        await actualizarDoc(documento('pedidos', id), { estado: 'cancelado', fechaCancelado: new Date() });
        cerrarModal('modalPedidoDetalle');
        mostrarAviso('Pedido cancelado.', 'ok');
    } catch (error) {
        console.error(error);
        mostrarAviso('No se pudo actualizar. Probá de nuevo.', 'error');
    }
};

window.editarPedido = function(id) {
    const p = pedidosData.find(x => x.id === id);
    if (!p) return;
    cerrarModal('modalPedidoDetalle');
    document.getElementById('pedido-edit-id').value = id;
    seleccionarTipoVenta('mayorista');
    prepararFormPedido(p);
    setTimeout(() => abrirModal('modalVenta'), 300);
};

window.guardarContactoDesdePedido = async function(id) {
    const p = pedidosData.find(x => x.id === id);
    if (!p) return;
    try {
        const ref = await crearDoc(coleccion('mayoristas'), { nombre: p.mayoristaNombre || 'Sin nombre', telefono: p.mayoristaTelefono || '', descuento: 0, diasAviso: null, notas: '', creado: new Date() });
        await actualizarDoc(documento('pedidos', id), { mayoristaId: ref.id });
        mostrarAviso('Contacto guardado.', 'ok');
    } catch (error) {
        console.error(error);
        mostrarAviso('No se pudo guardar. Probá de nuevo.', 'error');
    }
};

window.verHistorialContacto = function(clave) {
    historialContactoAbierto = clave;
    renderHistorialContacto();
    abrirModal('modalHistorialContacto');
};

function renderHistorialContacto() {
    const cont = document.getElementById('historial-contacto-contenido');
    const grupo = gruposHistorialMayorista[historialContactoAbierto];
    const contacto = mayoristasData.find(m => m.id === historialContactoAbierto);
    const nombre = grupo?.nombre || contacto?.nombre || '';
    const pedidos = [...(grupo?.pedidos || [])].sort((a, b) => (aFecha(b.timestamp)?.getTime() || 0) - (aFecha(a.timestamp)?.getTime() || 0));

    if (!pedidos.length) {
        cont.innerHTML = `<p class="font-black text-gray-800 text-lg mb-3">${escaparHtml(nombre)}</p><p class="text-center text-gray-400 py-8 border border-dashed border-gray-200 rounded-xl text-sm font-medium">Todavía no realizó compras.</p>`;
        return;
    }

    const porProducto = {};
    pedidos.forEach(p => (p.items || []).forEach(it => { porProducto[it.nombre] = (porProducto[it.nombre] || 0) + Number(it.cantidad); }));
    const unidades = pedidos.reduce((s, p) => s + (Number(p.unidades) || 0), 0);
    const total = pedidos.reduce((s, p) => s + (Number(p.total) || 0), 0);

    cont.innerHTML = `
        <p class="font-black text-gray-800 text-lg mb-3">${escaparHtml(nombre)}</p>
        <div class="grid grid-cols-3 gap-2 mb-4 text-center">
            <div class="bg-violet-50 rounded-xl p-2 border border-violet-100"><p class="text-lg font-black text-violet-700">${pedidos.length}</p><p class="text-[9px] uppercase font-bold text-gray-400">Compras</p></div>
            <div class="bg-violet-50 rounded-xl p-2 border border-violet-100"><p class="text-lg font-black text-violet-700">${unidades}</p><p class="text-[9px] uppercase font-bold text-gray-400">Unidades</p></div>
            <div class="bg-violet-50 rounded-xl p-2 border border-violet-100"><p class="text-sm font-black text-violet-700 leading-7">${formatearDinero(total)}</p><p class="text-[9px] uppercase font-bold text-gray-400">Total</p></div>
        </div>
        <div class="bg-gray-50 rounded-xl p-3 border border-gray-100 mb-4">
            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Lo que más compra</p>
            ${Object.entries(porProducto).sort((a, b) => b[1] - a[1]).map(([n, c]) => `<div class="flex justify-between text-sm"><span class="text-gray-600">${escaparHtml(n)}</span><span class="font-black text-gray-800">${c} u.</span></div>`).join('')}
        </div>
        <div class="flex flex-col gap-2">
            ${pedidos.map(p => `
                <button onclick="verDetallePedido('${p.id}')" class="w-full text-left bg-white rounded-xl p-3 border border-gray-100 shadow-sm active:bg-gray-50">
                    <div class="flex justify-between items-center mb-1.5">
                        <span class="text-sm font-bold text-gray-800"><i class="fa-regular fa-calendar text-violet-500 mr-1"></i>${formatearFecha(p.timestamp)}</span>
                        <span class="font-black text-violet-700">${formatearDinero(p.total)}</span>
                    </div>
                    <div class="flex justify-between items-end gap-2">
                        <div class="text-xs text-gray-500 leading-relaxed">${(p.items || []).map(it => `${it.cantidad} × ${escaparHtml(it.nombre)}`).join('<br>')}</div>
                        ${chipEstado(p.estado)}
                    </div>
                </button>`).join('')}
        </div>`;
}

window.abrirContacto = function(id = null) {
    const m = id ? mayoristasData.find(x => x.id === id) : null;
    document.getElementById('titulo-modal-contacto').innerText = m ? 'Editar Contacto' : 'Nuevo Contacto';
    document.getElementById('contacto-id').value = m?.id || '';
    document.getElementById('contacto-nombre').value = m?.nombre || '';
    document.getElementById('contacto-telefono').value = m?.telefono || '';
    document.getElementById('contacto-dias-aviso').value = m?.diasAviso || '';
    document.getElementById('contacto-notas').value = m?.notas || '';
    elegirDescuento('contacto', m?.descuento || 0);

    const acciones = document.getElementById('contacto-acciones');
    acciones.classList.toggle('hidden', !m);
    acciones.classList.toggle('flex', !!m);
    if (m) {
        document.getElementById('contacto-enviar-link').onclick = () => enviarLinkPedido(m.id);
        document.getElementById('contacto-copiar-link').onclick = () => copiarLinkPedido(m.id);
        document.getElementById('contacto-ver-historial').onclick = () => { cerrarModal('modalContacto'); setTimeout(() => verHistorialContacto(m.id), 300); };
    }
    // si el cliente vino del CRM, el admin puede ver su recorrido comercial
    const ficha = m && esAdmin ? prospectosData.find(p => p.mayoristaId === m.id) : null;
    const btnFicha = document.getElementById('contacto-ver-ficha');
    btnFicha.classList.toggle('hidden', !ficha);
    if (ficha) btnFicha.onclick = () => { cerrarModal('modalContacto'); setTimeout(() => abrirFichaProspecto(ficha.id), 300); };
    abrirModal('modalContacto');
};

window.guardarContacto = async function(e) {
    e.preventDefault();
    await conBotonBloqueado(e, async () => {
        const id = document.getElementById('contacto-id').value;
        const telefono = document.getElementById('contacto-telefono').value.trim();
        const diasAviso = parseInt(document.getElementById('contacto-dias-aviso').value, 10);
        const data = {
            nombre: document.getElementById('contacto-nombre').value.trim(),
            telefono,
            descuento: Number(document.getElementById('contacto-descuento').value) || 0,
            diasAviso: diasAviso > 0 ? diasAviso : null,
            notas: document.getElementById('contacto-notas').value.trim()
        };
        const duplicado = telefono && mayoristasData.find(m => m.id !== id && normalizarTelefono(m.telefono) === normalizarTelefono(telefono));
        if (duplicado) { mostrarAviso(`Ese número ya es de ${duplicado.nombre}.`, 'error'); return; }

        try {
            if (id) await actualizarDoc(documento('mayoristas', id), data);
            else await crearDoc(coleccion('mayoristas'), { ...data, creado: new Date() });
            cerrarModal('modalContacto');
            mostrarAviso(id ? 'Contacto actualizado.' : 'Contacto creado.', 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo guardar. Probá de nuevo.', 'error');
        }
    });
};

window.enviarLinkPedido = function(id) {
    const m = mayoristasData.find(x => x.id === id);
    const url = m && linkWhatsApp(m.telefono, mensajeLinkPedido(m));
    if (!url) { mostrarAviso('El contacto no tiene WhatsApp cargado.', 'error'); return; }
    window.open(url, '_blank');
};

window.copiarLinkPedido = async function(id = null) {
    const link = linkPedido(id);
    try {
        await navigator.clipboard.writeText(link);
        mostrarAviso(id ? 'Link del contacto copiado.' : 'Link general copiado.', 'ok');
    } catch {
        prompt('Copiá el link de pedidos:', link);
    }
};

// ---------- CRM comercial (solo admin) ----------
const ETAPAS_CRM = {
    nuevo:       { texto: 'Nuevo',       clases: 'bg-sky-100 text-sky-700',       icono: 'fa-seedling' },
    contactado:  { texto: 'Contactado',  clases: 'bg-indigo-100 text-indigo-700', icono: 'fa-comment-dots' },
    evaluacion:  { texto: 'Evaluación',  clases: 'bg-amber-100 text-amber-700',   icono: 'fa-scale-balanced' },
    negociacion: { texto: 'Negociación', clases: 'bg-orange-100 text-orange-700', icono: 'fa-handshake' },
    cliente:     { texto: 'Cliente',     clases: 'bg-green-100 text-green-700',   icono: 'fa-store' },
    pausa:       { texto: 'En pausa',    clases: 'bg-gray-200 text-gray-600',     icono: 'fa-pause' },
    descartado:  { texto: 'Descartado',  clases: 'bg-red-100 text-red-600',       icono: 'fa-ban' }
};
const SITUACIONES_CRM = { interesado: 'Interesado', seguimiento: 'Seguimiento pendiente', no_interesado: 'No interesado' };
const CANALES_CRM = {
    whatsapp:  { texto: 'WhatsApp',  icono: 'fa-brands fa-whatsapp' },
    instagram: { texto: 'Instagram', icono: 'fa-brands fa-instagram' },
    llamada:   { texto: 'Llamada',   icono: 'fa-solid fa-phone' },
    visita:    { texto: 'Visita',    icono: 'fa-solid fa-person-walking' },
    otro:      { texto: 'Otro',      icono: 'fa-solid fa-ellipsis' }
};
const ETAPAS_EN_CURSO = ['nuevo', 'contactado', 'evaluacion', 'negociacion'];
const ETAPAS_SIN_SEGUIMIENTO = ['cliente', 'descartado'];
// "No interesado" no queda guardado como etapa: se resuelve en "En pausa" o "Descartado"
const OPCIONES_ETAPA = [
    ['nuevo', 'Nuevo'],
    ['contactado', 'Contactado'],
    ['evaluacion:interesado', 'Evaluación · Interesado'],
    ['evaluacion:seguimiento', 'Evaluación · Seguimiento pendiente'],
    ['evaluacion:no_interesado', 'Evaluación · No interesado'],
    ['negociacion', 'Negociación'],
    ['pausa', 'En pausa'],
    ['descartado', 'Descartado']
];
const OPCIONES_ETAPA_EN_CURSO = OPCIONES_ETAPA.filter(([valor]) => ETAPAS_EN_CURSO.includes(valor.split(':')[0]) && valor !== 'evaluacion:no_interesado');
const RUBROS_SUGERIDOS = ['Cancha de fútbol', 'Kiosco', 'Drugstore', 'Gastronómico'];

let prospectosData = [];
let estadoCrm = 'cargando';
let subPestanaCrm = 'prospectos';
let prospectoAbierto = null;
let movimientoCrm = { id: null, modo: 'contacto', noInteresado: false };
let variedadesForm = [];
let conversionCrm = { id: null, destino: null, forzarNuevo: false };
let prospectoAEliminar = null;

const normalizarTexto = (texto) => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const fechaAInput = (fecha) => {
    const d = aFecha(fecha);
    return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
};
// los días elegidos se guardan al mediodía para que el huso horario no los corra de fecha
const inputAFecha = (valor) => {
    if (!valor) return null;
    const [anio, mes, dia] = valor.split('-').map(Number);
    return new Date(anio, mes - 1, dia, 12);
};
// si el día elegido es hoy se guarda la hora real, así el historial queda bien ordenado
const fechaElegida = (valor) => valor === fechaAInput(new Date()) ? new Date() : inputAFecha(valor);
const sumarDias = (dias) => {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return d;
};
const formatearDiaMes = (fecha) => aFecha(fecha)?.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) || '';
const haceDias = (fecha) => {
    const n = diasEntre(aFecha(fecha), new Date());
    return n <= 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} días`;
};

const clienteDeProspecto = (p) => p.mayoristaId ? mayoristasData.find(m => m.id === p.mayoristaId) || null : null;
// una vez que es cliente, el nombre y el WhatsApp salen del panel mayorista (un solo registro)
const datosProspecto = (p) => {
    const m = clienteDeProspecto(p);
    return m ? { ...p, nombre: m.nombre, telefono: m.telefono || '' } : p;
};
const ultimoContacto = (p) => (p.interacciones || []).filter(i => i.tipo === 'contacto').reduce((max, i) => {
    const f = aFecha(i.fecha);
    return f && (!max || f > max) ? f : max;
}, null);
const estadoSeguimiento = (p) => {
    if (!p.proximoSeguimiento || ETAPAS_SIN_SEGUIMIENTO.includes(p.etapa)) return null;
    const dias = diasEntre(new Date(), aFecha(p.proximoSeguimiento));
    return dias < 0 ? 'atrasado' : dias === 0 ? 'hoy' : 'proximo';
};
const textoSeguimiento = (p) => {
    const d = aFecha(p.proximoSeguimiento);
    if (!d) return '';
    const dias = diasEntre(new Date(), d);
    if (dias < 0) return `Atrasado ${plural(-dias, 'día', 'días')}`;
    if (dias === 0) return 'Hoy';
    if (dias === 1) return 'Mañana';
    return `${formatearDiaMes(d)} · en ${dias} días`;
};
const valorEtapa = (p) => p.etapa === 'evaluacion' ? `evaluacion:${p.situacion || 'interesado'}` : p.etapa;
const textoEtapa = (etapa, situacion) => (ETAPAS_CRM[etapa]?.texto || 'Nuevo') + (etapa === 'evaluacion' && SITUACIONES_CRM[situacion] ? ` (${SITUACIONES_CRM[situacion].toLowerCase()})` : '');
const chipEtapa = (p) => {
    const e = ETAPAS_CRM[p.etapa] || ETAPAS_CRM.nuevo;
    const situacion = p.etapa === 'evaluacion' && SITUACIONES_CRM[p.situacion] ? ` · ${SITUACIONES_CRM[p.situacion]}` : '';
    return `<span class="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${e.clases}"><i class="fa-solid ${e.icono} mr-1"></i>${e.texto}${situacion}</span>`;
};
const linkInstagram = (valor) => {
    const texto = String(valor || '').trim();
    if (!texto) return '';
    if (/^https?:\/\//i.test(texto) && !/instagram\.com/i.test(texto)) return texto;
    const usuario = texto.replace(/^https?:\/\//i, '').replace(/^(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#\s]/)[0];
    return usuario ? `https://instagram.com/${encodeURIComponent(usuario)}` : '';
};
const linkMapa = (p) => p.direccion ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.direccion, p.zona].filter(Boolean).join(', '))}` : '';
const nombresVariedades = (p) => (p.variedades || []).map(v => productosData.find(x => x.id === v.id)?.nombre || v.nombre);
// agrupa "kiosco" y "Kiosco" como un solo valor
const valoresUnicosCrm = (campo) => {
    const mapa = new Map();
    prospectosData.forEach(p => {
        const valor = String(p[campo] || '').trim();
        const clave = normalizarTexto(valor);
        if (clave && !mapa.has(clave)) mapa.set(clave, valor);
    });
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1]));
};

function resumenSeguimientos() {
    const r = { atrasados: [], hoy: [], proximos: [], sinFecha: [] };
    prospectosData.map(datosProspecto).forEach(p => {
        const estado = estadoSeguimiento(p);
        if (estado === 'atrasado') r.atrasados.push(p);
        else if (estado === 'hoy') r.hoy.push(p);
        else if (estado === 'proximo') r.proximos.push(p);
        else if (ETAPAS_EN_CURSO.includes(p.etapa)) r.sinFecha.push(p);
    });
    const porFecha = (a, b) => aFecha(a.proximoSeguimiento) - aFecha(b.proximoSeguimiento);
    [r.atrasados, r.hoy, r.proximos].forEach(lista => lista.sort(porFecha));
    r.sinFecha.sort((a, b) => (aFecha(a.creado)?.getTime() || 0) - (aFecha(b.creado)?.getTime() || 0));
    return r;
}

const avisoEstadoCrm = () => estadoCrm === 'error'
    ? `<div class="text-center py-10 bg-white rounded-2xl border border-dashed border-red-200 shadow-sm"><i class="fa-solid fa-lock text-4xl text-red-200 mb-3 block"></i><p class="text-gray-500 font-medium px-6">No se pudo cargar el CRM. Revisá la conexión o los permisos de la cuenta.</p></div>`
    : `<p class="text-center text-gray-500 mt-10">Cargando CRM...</p>`;

window.cambiarSubPestanaCrm = function(sub) {
    subPestanaCrm = sub;
    renderCrm();
};

window.irACrm = function(sub) {
    subPestanaCrm = sub;
    cambiarPestana('crm');
};

function renderCrm() {
    if (!esAdmin) return;
    const r = resumenSeguimientos();
    const pendientes = r.atrasados.length + r.hoy.length;

    const badge = document.getElementById('badge-crm');
    badge.innerText = pendientes;
    badge.classList.toggle('hidden', !pendientes);
    badge.classList.toggle('flex', pendientes > 0);

    const subtabs = [
        { id: 'prospectos', texto: 'Prospectos', icono: 'fa-store', badge: 0 },
        { id: 'seguimientos', texto: 'Seguimientos', icono: 'fa-bell', badge: pendientes },
        { id: 'clientes', texto: 'Clientes', icono: 'fa-handshake', badge: 0 }
    ];
    document.getElementById('subtabs-crm').innerHTML = subtabs.map(s => {
        const activa = subPestanaCrm === s.id;
        const badgeHtml = s.badge ? `<span class="absolute -top-1.5 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] flex items-center justify-center bg-red-500 text-white shadow-sm">${s.badge}</span>` : '';
        return `<button onclick="cambiarSubPestanaCrm('${s.id}')" class="relative py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${activa ? 'bg-teal-600 text-white shadow-sm' : 'text-gray-500'}"><i class="fa-solid ${s.icono} hidden min-[400px]:inline"></i>${s.texto}${badgeHtml}</button>`;
    }).join('');

    document.querySelectorAll('.subtab-crm').forEach(el => el.classList.add('hidden'));
    document.getElementById(`crm-${subPestanaCrm}`).classList.remove('hidden');

    renderSugerenciasCrm();
    renderIndicadoresCrm(r);
    renderOpcionesFiltrosCrm();
    renderListaCrm();
    renderSeguimientosCrm(r);
    renderClientesCrm();
}

function renderSugerenciasCrm() {
    const rubros = new Map(RUBROS_SUGERIDOS.map(r => [normalizarTexto(r), r]));
    valoresUnicosCrm('rubro').forEach(([clave, texto]) => { if (!rubros.has(clave)) rubros.set(clave, texto); });
    document.getElementById('crm-lista-rubros').innerHTML = [...rubros.values()].map(v => `<option value="${escaparHtml(v)}"></option>`).join('');
    document.getElementById('crm-lista-zonas').innerHTML = valoresUnicosCrm('zona').map(([, v]) => `<option value="${escaparHtml(v)}"></option>`).join('');
}

function renderIndicadoresCrm(r) {
    const cuenta = (etapa) => prospectosData.filter(p => p.etapa === etapa).length;
    const tiles = [
        [prospectosData.length, 'Registrados', `filtrarEtapaCrm('todas')`, 'text-gray-800'],
        [cuenta('nuevo'), 'Nuevos', `filtrarEtapaCrm('nuevo')`, 'text-sky-600'],
        [cuenta('negociacion'), 'En negociación', `filtrarEtapaCrm('negociacion')`, 'text-orange-600'],
        [r.atrasados.length + r.hoy.length, 'Seguimientos pendientes', `cambiarSubPestanaCrm('seguimientos')`, r.atrasados.length ? 'text-red-600' : 'text-teal-600'],
        [cuenta('cliente'), 'Clientes', `cambiarSubPestanaCrm('clientes')`, 'text-green-600'],
        [cuenta('descartado'), 'Descartados', `filtrarEtapaCrm('descartado')`, 'text-red-500']
    ];
    document.getElementById('crm-indicadores').innerHTML = tiles.map(([valor, texto, accion, color]) => `
        <button onclick="${accion}" class="bg-white rounded-xl p-2.5 shadow-sm border border-gray-100 text-center active:bg-gray-50 transition-colors">
            <p class="text-xl font-black ${color} leading-tight">${valor}</p>
            <p class="text-[9px] uppercase font-bold text-gray-400 leading-tight mt-0.5">${texto}</p>
        </button>`).join('');
}

function renderOpcionesFiltrosCrm() {
    [['crm-f-rubro', 'rubro', 'Todos'], ['crm-f-zona', 'zona', 'Todas']].forEach(([id, campo, todos]) => {
        const select = document.getElementById(id);
        const elegido = select.value;
        const opciones = valoresUnicosCrm(campo);
        select.innerHTML = `<option value="">${todos}</option>` + opciones.map(([clave, texto]) => `<option value="${escaparHtml(clave)}">${escaparHtml(texto)}</option>`).join('');
        select.value = opciones.some(([clave]) => clave === elegido) ? elegido : '';
    });
}

window.filtrarCrm = function() {
    renderListaCrm();
};

window.filtrarEtapaCrm = function(etapa) {
    document.getElementById('crm-f-etapa').value = etapa;
    subPestanaCrm = 'prospectos';
    renderCrm();
};

window.alternarFiltrosCrm = function() {
    const panel = document.getElementById('crm-filtros');
    const abrir = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !abrir);
    panel.classList.toggle('grid', abrir);
};

window.limpiarFiltrosCrm = function() {
    document.getElementById('crm-busqueda').value = '';
    document.getElementById('crm-f-etapa').value = 'activos';
    ['crm-f-rubro', 'crm-f-zona', 'crm-f-ultimo', 'crm-f-proximo'].forEach(id => { document.getElementById(id).value = ''; });
    renderListaCrm();
};

function prospectosFiltrados() {
    const busqueda = normalizarTexto(document.getElementById('crm-busqueda').value);
    const digitos = busqueda.replace(/\D/g, '');
    let etapa = document.getElementById('crm-f-etapa').value;
    // al buscar se mira todo, así también aparecen los pausados, descartados o clientes
    if (busqueda && etapa === 'activos') etapa = 'todas';
    const rubro = document.getElementById('crm-f-rubro').value;
    const zona = document.getElementById('crm-f-zona').value;
    const ultimo = document.getElementById('crm-f-ultimo').value;
    const proximo = document.getElementById('crm-f-proximo').value;

    // se guarda también el nombre que tenía en el CRM, por si el cliente vinculado se llama distinto
    return prospectosData.map(p => ({ ...datosProspecto(p), nombreEnCrm: p.nombre })).filter(p => {
        if (etapa === 'activos' ? !ETAPAS_EN_CURSO.includes(p.etapa) : etapa !== 'todas' && p.etapa !== etapa) return false;
        if (rubro && normalizarTexto(p.rubro) !== rubro) return false;
        if (zona && normalizarTexto(p.zona) !== zona) return false;
        if (ultimo) {
            const u = ultimoContacto(p);
            if (ultimo === 'nunca' ? u : !u || diasEntre(u, new Date()) < Number(ultimo)) return false;
        }
        if (proximo) {
            const estado = estadoSeguimiento(p);
            if (proximo === 'sin' && p.proximoSeguimiento) return false;
            if (proximo === 'atrasado' && estado !== 'atrasado') return false;
            if (proximo === 'hoy' && estado !== 'hoy') return false;
            if (proximo === 'semana' && !(estado === 'hoy' || (estado === 'proximo' && diasEntre(new Date(), aFecha(p.proximoSeguimiento)) <= 7))) return false;
        }
        if (busqueda) {
            const texto = normalizarTexto([p.nombre, p.nombreEnCrm, p.contacto, p.instagram, p.rubro, p.zona, p.direccion].join(' '));
            const tel = String(p.telefono || '').replace(/\D/g, '');
            if (!texto.includes(busqueda) && !(digitos.length >= 3 && tel.includes(digitos))) return false;
        }
        return true;
    });
}

const tarjetaProspecto = (p) => {
    const estado = estadoSeguimiento(p);
    const u = ultimoContacto(p);
    const wa = linkWhatsApp(p.telefono);
    const borde = { atrasado: 'border-l-red-500', hoy: 'border-l-orange-400' }[estado] || 'border-l-teal-500';
    const colorSeg = { atrasado: 'bg-red-50 text-red-600', hoy: 'bg-orange-50 text-orange-600', proximo: 'bg-gray-100 text-gray-600' }[estado];
    const lugar = [p.rubro, p.zona].filter(Boolean).map(escaparHtml).join(' · ');
    const seguimiento = estado
        ? `<span class="px-2 py-0.5 rounded ${colorSeg}"><i class="fa-regular fa-calendar mr-1"></i>${textoSeguimiento(p)}</span>`
        : ETAPAS_EN_CURSO.includes(p.etapa) ? `<span class="text-gray-400"><i class="fa-regular fa-calendar-xmark mr-1"></i>Sin seguimiento</span>` : '';
    return `
    <div class="bg-white rounded-xl shadow-sm border-l-4 ${borde} flex">
        <button onclick="abrirFichaProspecto('${p.id}')" class="flex-1 min-w-0 text-left p-4 active:bg-gray-50 rounded-l-xl">
            <p class="font-bold text-gray-800 truncate">${escaparHtml(p.nombre)}</p>
            <div class="flex items-center gap-2 mt-1 min-w-0">${chipEtapa(p)}${lugar ? `<span class="text-xs text-gray-500 font-medium truncate">${lugar}</span>` : ''}</div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] font-bold">
                ${seguimiento}
                <span class="text-gray-400"><i class="fa-regular fa-comments mr-1"></i>${u ? 'Último contacto ' + haceDias(u) : 'Sin contactar'}</span>
            </div>
            ${estado && p.proximoPaso ? `<p class="text-xs text-gray-600 mt-1.5 truncate"><i class="fa-solid fa-arrow-right text-teal-500 mr-1"></i>${escaparHtml(p.proximoPaso)}</p>` : ''}
        </button>
        ${wa ? `<a href="${wa}" target="_blank" class="w-12 shrink-0 flex items-center justify-center text-green-500 text-2xl border-l border-gray-100 active:bg-green-50 rounded-r-xl" aria-label="Escribir por WhatsApp"><i class="fa-brands fa-whatsapp"></i></a>` : ''}
    </div>`;
};

function renderListaCrm() {
    const cont = document.getElementById('crm-lista');
    const etapaFiltro = document.getElementById('crm-f-etapa').value;
    const filtrosActivos = ['crm-f-rubro', 'crm-f-zona', 'crm-f-ultimo', 'crm-f-proximo'].filter(id => document.getElementById(id).value).length + (etapaFiltro !== 'activos' ? 1 : 0);
    const badge = document.getElementById('crm-filtros-badge');
    badge.innerText = filtrosActivos;
    badge.classList.toggle('hidden', !filtrosActivos);
    badge.classList.toggle('flex', filtrosActivos > 0);

    if (estadoCrm !== 'listo') { cont.innerHTML = avisoEstadoCrm(); return; }
    if (!prospectosData.length) {
        cont.innerHTML = `<div class="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm"><i class="fa-solid fa-store text-4xl text-gray-200 mb-3 block"></i><p class="text-gray-500 font-medium px-6">Todavía no cargaste negocios. Tocá <span class="text-teal-600 font-bold">+ Negocio</span> para empezar.</p></div>`;
        return;
    }

    // primero los que tienen seguimiento más cercano, después los más nuevos
    const orden = (p) => estadoSeguimiento(p) ? aFecha(p.proximoSeguimiento).getTime() : Infinity;
    const lista = prospectosFiltrados().sort((a, b) => (orden(a) - orden(b)) || ((aFecha(b.creado)?.getTime() || 0) - (aFecha(a.creado)?.getTime() || 0)));
    let html = lista.length
        ? lista.map(tarjetaProspecto).join('')
        : `<p class="text-center text-sm text-gray-400 font-medium py-8 bg-white rounded-xl border border-dashed border-gray-200">Ningún negocio coincide con la búsqueda o los filtros.</p>`;

    if (etapaFiltro === 'activos' && !document.getElementById('crm-busqueda').value.trim()) {
        const textos = { pausa: ['en pausa', 'en pausa'], descartado: ['descartado', 'descartados'], cliente: ['cliente', 'clientes'] };
        const ocultos = Object.keys(textos).map(e => [e, prospectosData.filter(p => p.etapa === e).length]).filter(([, n]) => n);
        if (ocultos.length) {
            html += `<button onclick="filtrarEtapaCrm('todas')" class="text-xs font-bold text-gray-400 py-2 text-center">No se muestran ${ocultos.map(([e, n]) => plural(n, ...textos[e])).join(', ')} · <span class="text-teal-600">Ver todos</span></button>`;
        }
    }
    cont.innerHTML = html;
}

const filaSeguimiento = (p, color) => {
    const wa = linkWhatsApp(p.telefono);
    return `
    <div class="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
        <button onclick="abrirFichaProspecto('${p.id}')" class="w-full text-left">
            <div class="flex justify-between items-start gap-2">
                <p class="font-bold text-gray-800 truncate min-w-0">${escaparHtml(p.nombre)}</p>
                <span class="text-[11px] font-black shrink-0 ${color}">${textoSeguimiento(p) || 'Sin fecha'}</span>
            </div>
            <div class="flex items-center gap-2 mt-1 min-w-0">${chipEtapa(p)}${p.proximoPaso ? `<span class="text-xs text-gray-500 truncate">${escaparHtml(p.proximoPaso)}</span>` : ''}</div>
        </button>
        <div class="grid ${wa ? 'grid-cols-2' : 'grid-cols-1'} gap-2 mt-2.5">
            ${wa ? `<a href="${wa}" target="_blank" class="bg-green-50 text-green-600 font-bold py-2 rounded-lg text-xs text-center active:bg-green-100"><i class="fa-brands fa-whatsapp mr-1"></i>WhatsApp</a>` : ''}
            <button onclick="abrirMovimientoCrm('${p.id}', 'contacto')" class="bg-teal-50 text-teal-700 font-bold py-2 rounded-lg text-xs active:bg-teal-100"><i class="fa-solid fa-pen-to-square mr-1"></i>Registrar contacto</button>
        </div>
    </div>`;
};

function renderSeguimientosCrm(r) {
    const cont = document.getElementById('crm-seguimientos');
    if (estadoCrm !== 'listo') { cont.innerHTML = avisoEstadoCrm(); return; }
    const grupo = (titulo, icono, color, lista) => !lista.length ? '' : `
        <div class="mb-5">
            <h3 class="text-xs font-black uppercase tracking-widest ${color} mb-2 px-1 flex items-center gap-2"><i class="fa-solid ${icono}"></i>${titulo}<span class="ml-auto bg-white border border-gray-100 text-gray-500 px-2 rounded-full">${lista.length}</span></h3>
            <div class="flex flex-col gap-2">${lista.map(p => filaSeguimiento(p, color)).join('')}</div>
        </div>`;
    const html = grupo('Atrasados', 'fa-triangle-exclamation', 'text-red-600', r.atrasados)
        + grupo('Para hoy', 'fa-bell', 'text-orange-600', r.hoy)
        + grupo('Próximos', 'fa-calendar-days', 'text-teal-700', r.proximos)
        + grupo('Sin seguimiento definido', 'fa-calendar-xmark', 'text-gray-500', r.sinFecha);
    cont.innerHTML = html
        ? `<div class="pb-8">${html}</div>`
        : `<div class="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm"><i class="fa-solid fa-calendar-check text-4xl text-gray-200 mb-3 block"></i><p class="text-gray-500 font-medium">No hay seguimientos pendientes.</p></div>`;
}

function renderClientesCrm() {
    const cont = document.getElementById('crm-clientes');
    if (estadoCrm !== 'listo') { cont.innerHTML = avisoEstadoCrm(); return; }
    const clientes = prospectosData.filter(p => p.etapa === 'cliente')
        .sort((a, b) => (aFecha(b.fechaConversion)?.getTime() || 0) - (aFecha(a.fechaConversion)?.getTime() || 0));
    const nota = `<p class="text-xs text-gray-500 font-medium mb-3 px-1"><i class="fa-solid fa-circle-info text-teal-500 mr-1"></i>Negocios que llegaron desde el CRM. Sus pedidos, descuentos y links se manejan en Mayorista.</p>`;
    if (!clientes.length) {
        cont.innerHTML = nota + `<div class="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm"><i class="fa-solid fa-handshake text-4xl text-gray-200 mb-3 block"></i><p class="text-gray-500 font-medium px-6">Todavía ningún negocio del CRM pasó a cliente.</p></div>`;
        return;
    }
    cont.innerHTML = nota + `<div class="flex flex-col gap-3 pb-8">${clientes.map(original => {
        const m = clienteDeProspecto(original);
        const p = datosProspecto(original);
        const est = m ? estadisticasContacto(m) : null;
        const demora = p.fechaConversion && p.creado ? diasEntre(aFecha(p.creado), aFecha(p.fechaConversion)) : null;
        const textoDemora = demora === null ? '' : demora <= 0 ? ' · se cerró el mismo día' : ` · se cerró en ${plural(demora, 'día', 'días')}`;
        return `
        <div class="bg-white rounded-xl p-4 shadow-sm border-l-4 border-l-green-500">
            <button onclick="abrirFichaProspecto('${p.id}')" class="w-full text-left">
                <p class="font-bold text-gray-800 truncate">${escaparHtml(p.nombre)}</p>
                <p class="text-xs text-gray-500 font-medium mt-0.5">Cliente desde ${formatearFecha(p.fechaConversion)}${textoDemora}</p>
            </button>
            ${m ? `
            <div class="grid grid-cols-2 gap-2 mt-3 text-center">
                <div class="bg-gray-50 rounded-lg p-2"><p class="text-lg font-black text-gray-800">${est.compras}</p><p class="text-[9px] uppercase font-bold text-gray-400 leading-tight">Compras</p></div>
                <div class="bg-gray-50 rounded-lg p-2"><p class="text-sm font-black text-gray-800 leading-7">${est.ultima ? formatearFecha(est.ultima) : '—'}</p><p class="text-[9px] uppercase font-bold text-gray-400 leading-tight">Última compra</p></div>
            </div>` : `<p class="mt-3 text-xs font-bold text-red-500"><i class="fa-solid fa-triangle-exclamation mr-1"></i>No se encontró en Mayorista → Contactos.</p>`}
            <div class="grid grid-cols-2 gap-2 mt-3">
                <button onclick="abrirFichaProspecto('${p.id}')" class="bg-teal-50 text-teal-700 font-bold py-2 rounded-lg text-xs active:bg-teal-100"><i class="fa-solid fa-briefcase mr-1"></i>Ficha comercial</button>
                <button onclick="verClienteEnMayorista('${p.id}')" class="bg-violet-50 text-violet-700 font-bold py-2 rounded-lg text-xs active:bg-violet-100"><i class="fa-solid fa-boxes-stacked mr-1"></i>Ver en Mayorista</button>
            </div>
        </div>`;
    }).join('')}</div>`;
}

function renderAlertaCrm() {
    const cont = document.getElementById('alertas-crm');
    let html = '';
    if (esAdmin && estadoCrm === 'listo') {
        const r = resumenSeguimientos();
        const total = r.atrasados.length + r.hoy.length;
        if (total) {
            const partes = [];
            if (r.atrasados.length) partes.push(plural(r.atrasados.length, 'atrasado', 'atrasados'));
            if (r.hoy.length) partes.push(`${r.hoy.length} para hoy`);
            html = `<button onclick="irACrm('seguimientos')" class="w-full text-left bg-teal-600 text-white rounded-2xl p-4 flex items-center gap-3 shadow-md active:scale-95 transition-all">
                <div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0"><i class="fa-solid fa-briefcase"></i></div>
                <div class="flex-1 min-w-0"><p class="font-bold">${plural(total, 'seguimiento pendiente', 'seguimientos pendientes')}</p><p class="text-xs text-white/80 truncate"><span class="font-bold text-white">${partes.join(' · ')}</span> · ${escaparHtml([...r.atrasados, ...r.hoy].map(p => p.nombre).join(', '))}</p></div>
                <i class="fa-solid fa-chevron-right text-white/70"></i>
            </button>`;
        }
    }
    cont.innerHTML = html;
    cont.classList.toggle('hidden', !html);
    cont.classList.toggle('flex', !!html);
}

// ----- Ficha comercial -----
window.abrirFichaProspecto = function(id) {
    if (!esAdmin) return;
    prospectoAbierto = id;
    renderFichaProspecto();
    abrirModal('modalFichaProspecto');
};

window.cerrarFichaProspecto = function() {
    prospectoAbierto = null;
    if (!document.getElementById('modalFichaProspecto').classList.contains('hidden')) cerrarModal('modalFichaProspecto');
};

const filaHistorialCrm = (i) => {
    let icono, color, titulo, detalle = '';
    if (i.tipo === 'contacto') {
        const canal = CANALES_CRM[i.canal] || CANALES_CRM.otro;
        icono = canal.icono;
        color = 'bg-teal-100 text-teal-700';
        titulo = `Contacto por ${canal.texto}`;
        detalle = escaparHtml(i.resumen);
        if (i.proximoPaso || i.proximaFecha) detalle += `<span class="block text-gray-400 mt-0.5"><i class="fa-solid fa-arrow-right mr-1"></i>${escaparHtml(i.proximoPaso || 'Seguimiento')}${i.proximaFecha ? ` · ${formatearFecha(i.proximaFecha)}` : ''}</span>`;
    } else if (i.tipo === 'etapa') {
        icono = 'fa-solid fa-arrow-right-arrow-left';
        color = 'bg-amber-100 text-amber-700';
        titulo = `${textoEtapa(i.de, i.situacionDe)} → ${textoEtapa(i.a, i.situacion)}`;
        detalle = [i.motivo === 'no_interesado' ? 'No interesado' : '', escaparHtml(i.nota)].filter(Boolean).join(' · ');
    } else if (i.tipo === 'conversion') {
        icono = 'fa-solid fa-store';
        color = 'bg-green-100 text-green-700';
        titulo = 'Pasó a cliente mayorista';
        detalle = escaparHtml(i.nota);
    } else {
        icono = 'fa-solid fa-flag';
        color = 'bg-sky-100 text-sky-700';
        titulo = `Se cargó en el CRM · ${textoEtapa(i.etapa, i.situacion)}`;
    }
    return `
    <div class="flex gap-3">
        <div class="w-8 h-8 rounded-full ${color} flex items-center justify-center shrink-0 text-xs"><i class="${icono}"></i></div>
        <div class="flex-1 min-w-0 pb-3 border-b border-gray-100">
            <div class="flex justify-between items-start gap-2"><p class="text-sm font-bold text-gray-800">${titulo}</p><span class="text-[11px] text-gray-400 font-bold shrink-0 mt-0.5">${formatearFecha(i.fecha)}</span></div>
            ${detalle ? `<p class="text-xs text-gray-600 mt-0.5 leading-relaxed break-words">${detalle}</p>` : ''}
        </div>
    </div>`;
};

function renderFichaProspecto() {
    const cont = document.getElementById('ficha-prospecto-contenido');
    const original = prospectosData.find(x => x.id === prospectoAbierto);
    if (!original) { cont.innerHTML = `<p class="text-center text-gray-400 py-8">Este negocio ya no está en el CRM.</p>`; return; }
    const p = datosProspecto(original);
    const cliente = clienteDeProspecto(original);
    const esCliente = p.etapa === 'cliente';
    const cerrado = ['pausa', 'descartado'].includes(p.etapa);
    const u = ultimoContacto(p);
    const estado = estadoSeguimiento(p);
    const variedades = nombresVariedades(p);

    const ig = linkInstagram(p.instagram);
    const enlace = (href, clases, icono, texto) => href ? `<a href="${escaparHtml(href)}" target="_blank" rel="noopener" class="flex-1 ${clases} font-bold py-2.5 rounded-xl text-xs text-center active:scale-95 transition-all"><i class="${icono} mr-1"></i>${texto}</a>` : '';
    const enlaces = [
        enlace(linkWhatsApp(p.telefono), 'bg-green-500 text-white', 'fa-brands fa-whatsapp', 'WhatsApp'),
        enlace(ig, 'bg-pink-50 text-pink-600', ig.includes('instagram.com') ? 'fa-brands fa-instagram' : 'fa-solid fa-globe', ig.includes('instagram.com') ? 'Instagram' : 'Red social'),
        enlace(linkMapa(p), 'bg-blue-50 text-blue-600', 'fa-solid fa-location-dot', 'Mapa')
    ].join('');

    const colorSeg = { atrasado: 'bg-red-50 border-red-200 text-red-700', hoy: 'bg-orange-50 border-orange-200 text-orange-700', proximo: 'bg-teal-50 border-teal-100 text-teal-800' }[estado];
    let seguimiento = '';
    if (estado) {
        seguimiento = `<div class="rounded-xl border p-3 mb-4 ${colorSeg}">
            <p class="text-[10px] uppercase font-black tracking-widest opacity-70">Próximo seguimiento</p>
            <p class="font-black">${textoSeguimiento(p)} <span class="font-medium text-xs opacity-70">(${formatearFecha(p.proximoSeguimiento)})</span></p>
            ${p.proximoPaso ? `<p class="text-sm font-medium mt-0.5"><i class="fa-solid fa-arrow-right mr-1"></i>${escaparHtml(p.proximoPaso)}</p>` : ''}
        </div>`;
    } else if (!ETAPAS_SIN_SEGUIMIENTO.includes(p.etapa)) {
        seguimiento = `<div class="rounded-xl border border-dashed border-gray-300 p-3 mb-4 text-sm text-gray-500 font-medium"><i class="fa-regular fa-calendar-xmark mr-1"></i>Sin seguimiento definido${p.proximoPaso ? ` · ${escaparHtml(p.proximoPaso)}` : ''}</div>`;
    }

    const boton = (onclick, clases, icono, texto) => `<button onclick="${onclick}" class="${clases} font-bold py-3 rounded-xl text-sm active:scale-95 transition-all"><i class="fa-solid ${icono} mr-1.5"></i>${texto}</button>`;
    const principal = 'w-full bg-teal-600 text-white shadow-lg shadow-teal-200';
    const secundario = 'bg-gray-50 border border-gray-100 text-gray-600';
    const editar = boton(`abrirProspecto('${p.id}')`, secundario, 'fa-pen', 'Editar datos');
    let acciones;
    if (esCliente) {
        acciones = `
            ${boton(`abrirMovimientoCrm('${p.id}', 'contacto')`, principal, 'fa-pen-to-square', 'Registrar contacto')}
            <div class="grid grid-cols-2 gap-2">${boton(`verClienteEnMayorista('${p.id}')`, 'bg-violet-50 text-violet-700', 'fa-boxes-stacked', 'Ver en Mayorista')}${editar}</div>
            ${cliente ? boton(`enviarLinkPedido('${cliente.id}')`, 'w-full bg-green-50 text-green-700', 'fa-link', 'Enviarle su link de pedidos') : ''}`;
    } else if (cerrado) {
        acciones = `
            ${boton(`abrirMovimientoCrm('${p.id}', 'reactivar')`, principal, 'fa-rotate-left', 'Reactivar')}
            <div class="grid grid-cols-2 gap-2">${boton(`abrirMovimientoCrm('${p.id}', 'contacto')`, secundario, 'fa-pen-to-square', 'Registrar contacto')}${editar}</div>`;
    } else {
        acciones = `
            ${boton(`abrirMovimientoCrm('${p.id}', 'contacto')`, principal, 'fa-pen-to-square', 'Registrar contacto')}
            <div class="grid grid-cols-2 gap-2">${boton(`abrirMovimientoCrm('${p.id}', 'etapa')`, secundario, 'fa-arrow-right-arrow-left', 'Cambiar etapa')}${editar}</div>
            ${boton(`abrirConvertirProspecto('${p.id}')`, 'w-full bg-green-50 text-green-700 border border-green-200', 'fa-store', 'Pasar a cliente mayorista')}`;
    }

    const dato = (icono, etiqueta, valor) => valor ? `
        <div class="flex gap-2.5">
            <i class="fa-solid ${icono} text-gray-300 w-4 text-center mt-1 text-sm"></i>
            <div class="min-w-0"><p class="text-[10px] uppercase font-bold text-gray-400 leading-tight">${etiqueta}</p><div class="text-sm font-medium text-gray-700 break-words">${valor}</div></div>
        </div>` : '';
    const historial = (p.interacciones || []).map((i, orden) => ({ ...i, orden }))
        .sort((a, b) => ((aFecha(b.fecha)?.getTime() || 0) - (aFecha(a.fecha)?.getTime() || 0)) || b.orden - a.orden);

    cont.innerHTML = `
        <div class="mb-4">
            <p class="text-xl font-black text-gray-800 break-words leading-tight">${escaparHtml(p.nombre)}</p>
            <div class="flex flex-wrap items-center gap-2 mt-1.5">${chipEtapa(p)}${p.rubro ? `<span class="text-xs font-bold text-gray-500">${escaparHtml(p.rubro)}</span>` : ''}</div>
        </div>
        ${enlaces ? `<div class="flex gap-2 mb-4">${enlaces}</div>` : ''}
        ${seguimiento}
        <div class="flex flex-col gap-2 mb-5">${acciones}</div>

        <div class="bg-gray-50 rounded-xl border border-gray-100 p-4 mb-4">
            <p class="text-[11px] font-black text-teal-700 uppercase tracking-widest mb-3">Datos del negocio</p>
            <div class="flex flex-col gap-3">
                ${dato('fa-user', 'Persona de contacto', escaparHtml(p.contacto))}
                ${dato('fa-phone', 'WhatsApp', escaparHtml(p.telefono))}
                ${dato('fa-hashtag', 'Instagram / red social', escaparHtml(p.instagram))}
                ${dato('fa-location-dot', 'Dirección', escaparHtml(p.direccion))}
                ${dato('fa-map', 'Zona o barrio', escaparHtml(p.zona))}
                ${dato('fa-calendar-plus', 'Alta en el CRM', formatearFecha(p.creado))}
            </div>
        </div>

        <div class="bg-gray-50 rounded-xl border border-gray-100 p-4 mb-5">
            <p class="text-[11px] font-black text-teal-700 uppercase tracking-widest mb-3">Información comercial</p>
            <div class="flex flex-col gap-3">
                ${dato('fa-signal', 'Canal de contacto', CANALES_CRM[p.canal]?.texto || '')}
                ${dato('fa-comments', 'Último contacto', u ? `${formatearFecha(u)} (${haceDias(u)})` : 'Todavía sin contactar')}
                ${dato('fa-box', 'Variedades de interés', variedades.length ? `<div class="flex flex-wrap gap-1.5 mt-1">${variedades.map(n => `<span class="text-[11px] font-bold bg-white border border-teal-100 text-teal-700 px-2 py-0.5 rounded-full">${escaparHtml(n)}</span>`).join('')}</div>` : '')}
                ${dato('fa-weight-scale', 'Volumen estimado', escaparHtml(p.volumen))}
                ${dato('fa-note-sticky', 'Observaciones', escaparHtml(p.observaciones).replace(/\n/g, '<br>'))}
                ${esCliente ? dato('fa-store', 'Cliente desde', formatearFecha(p.fechaConversion)) : ''}
            </div>
        </div>

        <p class="text-[11px] font-black text-teal-700 uppercase tracking-widest mb-3 px-1">Historial (${historial.length})</p>
        <div class="flex flex-col gap-3">${historial.map(filaHistorialCrm).join('') || `<p class="text-sm text-gray-400">Sin movimientos.</p>`}</div>`;
}

window.verClienteEnMayorista = function(id) {
    const p = prospectosData.find(x => x.id === id);
    const m = p && clienteDeProspecto(p);
    if (!m) { mostrarAviso('No se encontró el cliente en Mayorista.', 'error'); return; }
    cerrarFichaProspecto();
    irAMayorista('contactos');
    setTimeout(() => abrirContacto(m.id), 300);
};

// ----- Alta y edición -----
function renderVariedadesProspecto() {
    const cont = document.getElementById('prospecto-variedades');
    const opciones = productosData.map(p => ({ id: p.id, nombre: p.nombre }));
    // si un producto se borró del catálogo, igual se muestra mientras esté elegido
    variedadesForm.forEach(v => { if (!opciones.some(o => o.id === v.id)) opciones.push(v); });
    if (!opciones.length) {
        cont.innerHTML = `<p class="text-xs text-gray-400 font-medium">Todavía no hay productos en el Catálogo.</p>`;
        return;
    }
    cont.innerHTML = opciones.map(o => {
        const activo = variedadesForm.some(v => v.id === o.id);
        return `<button type="button" data-id="${escaparHtml(o.id)}" onclick="alternarVariedad(this.dataset.id)" class="px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${activo ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-200 text-gray-600'}">${activo ? '<i class="fa-solid fa-check mr-1"></i>' : ''}${escaparHtml(o.nombre)}</button>`;
    }).join('');
}

window.alternarVariedad = function(id) {
    if (variedadesForm.some(v => v.id === id)) {
        variedadesForm = variedadesForm.filter(v => v.id !== id);
    } else {
        const producto = productosData.find(p => p.id === id);
        if (producto) variedadesForm.push({ id, nombre: producto.nombre });
    }
    renderVariedadesProspecto();
};

window.abrirProspecto = function(id = null) {
    if (!esAdmin) return;
    const p = id ? prospectosData.find(x => x.id === id) : null;
    const datos = p ? datosProspecto(p) : {};
    const esCliente = p?.etapa === 'cliente';

    document.getElementById('titulo-modal-prospecto').innerText = p ? 'Editar negocio' : 'Nuevo negocio';
    document.getElementById('prospecto-id').value = p?.id || '';
    const campos = { nombre: datos.nombre, telefono: datos.telefono, rubro: p?.rubro, zona: p?.zona, contacto: p?.contacto, instagram: p?.instagram, direccion: p?.direccion, volumen: p?.volumen, observaciones: p?.observaciones, paso: p?.proximoPaso };
    Object.entries(campos).forEach(([campo, valor]) => { document.getElementById(`prospecto-${campo}`).value = valor || ''; });
    ['nombre', 'telefono'].forEach(campo => { document.getElementById(`prospecto-${campo}`).disabled = esCliente; });
    document.getElementById('prospecto-nota-cliente').classList.toggle('hidden', !esCliente);

    const alta = document.getElementById('prospecto-alta');
    alta.value = fechaAInput(p?.creado || new Date());
    alta.max = fechaAInput(new Date());
    const canal = document.getElementById('prospecto-canal');
    canal.innerHTML = `<option value="">Sin definir</option>` + Object.entries(CANALES_CRM).map(([valor, c]) => `<option value="${valor}">${c.texto}</option>`).join('');
    canal.value = p?.canal || '';

    const etapa = document.getElementById('prospecto-etapa');
    etapa.innerHTML = OPCIONES_ETAPA_EN_CURSO.map(([valor, texto]) => `<option value="${valor}">${texto}</option>`).join('');
    etapa.value = 'nuevo';
    // en una ficha existente la etapa se cambia con "Cambiar etapa", para que quede en el historial
    document.getElementById('prospecto-etapa-box').classList.toggle('hidden', !!p);
    document.getElementById('prospecto-seguimiento-box').classList.toggle('hidden', !!p && ETAPAS_SIN_SEGUIMIENTO.includes(p.etapa));
    document.getElementById('prospecto-proximo').value = fechaAInput(p?.proximoSeguimiento);

    variedadesForm = (p?.variedades || []).map(v => ({ id: v.id, nombre: v.nombre }));
    renderVariedadesProspecto();

    const eliminar = document.getElementById('prospecto-eliminar');
    eliminar.classList.toggle('hidden', !p);
    eliminar.classList.toggle('flex', !!p);
    abrirModal('modalProspecto');
};

window.guardarProspecto = async function(e) {
    e.preventDefault();
    if (!esAdmin) return;
    await conBotonBloqueado(e, async () => {
        const id = document.getElementById('prospecto-id').value;
        const actual = id ? prospectosData.find(x => x.id === id) : null;
        const valor = (campo) => document.getElementById(`prospecto-${campo}`).value.trim();
        const nombre = valor('nombre');
        const telefono = valor('telefono');

        // un cliente ya convertido toma nombre y WhatsApp del panel mayorista, así que no se controla
        if (!actual?.mayoristaId) {
            const tel = normalizarTelefono(telefono);
            const cliente = tel && mayoristasData.find(m => normalizarTelefono(m.telefono) === tel);
            if (cliente) { mostrarAviso(`Ese WhatsApp ya es del cliente ${escaparHtml(cliente.nombre)}.`, 'error'); return; }
            const repetido = tel && prospectosData.find(x => x.id !== id && !x.mayoristaId && normalizarTelefono(x.telefono) === tel);
            if (repetido) { mostrarAviso(`Ese WhatsApp ya está cargado en ${escaparHtml(repetido.nombre)}.`, 'error'); return; }

            const clave = normalizarTexto(nombre);
            const clienteMismoNombre = mayoristasData.find(m => normalizarTexto(m.nombre) === clave);
            const prospectoMismoNombre = prospectosData.find(x => x.id !== id && normalizarTexto(datosProspecto(x).nombre) === clave);
            const aviso = clienteMismoNombre ? `Ya hay un cliente mayorista llamado "${clienteMismoNombre.nombre}".`
                : prospectoMismoNombre ? `Ya hay un negocio en el CRM llamado "${prospectoMismoNombre.nombre}".` : '';
            const cambioNombre = !actual || normalizarTexto(actual.nombre) !== clave;
            if (aviso && cambioNombre && !confirm(`${aviso}\n¿Lo guardo igual?`)) return;
        }

        const alta = document.getElementById('prospecto-alta').value;
        const datos = {
            rubro: valor('rubro'),
            zona: valor('zona'),
            contacto: valor('contacto'),
            instagram: valor('instagram'),
            direccion: valor('direccion'),
            canal: document.getElementById('prospecto-canal').value,
            variedades: variedadesForm,
            volumen: valor('volumen'),
            observaciones: valor('observaciones'),
            creado: (actual && fechaAInput(actual.creado) === alta ? actual.creado : null) || fechaElegida(alta) || new Date()
        };
        if (!actual?.mayoristaId) {
            datos.nombre = nombre;
            datos.telefono = telefono;
        }
        if (!actual || !ETAPAS_SIN_SEGUIMIENTO.includes(actual.etapa)) {
            datos.proximoSeguimiento = inputAFecha(document.getElementById('prospecto-proximo').value);
            datos.proximoPaso = valor('paso');
        }

        try {
            if (actual) {
                await actualizarDoc(documento('prospectos', id), datos);
                cerrarModal('modalProspecto');
                mostrarAviso('Datos actualizados.', 'ok');
            } else {
                const [etapa, situacion = null] = document.getElementById('prospecto-etapa').value.split(':');
                const ref = await crearDoc(coleccion('prospectos'), {
                    ...datos,
                    etapa,
                    situacion,
                    mayoristaId: null,
                    interacciones: [{ tipo: 'alta', fecha: datos.creado, etapa, situacion }]
                });
                cerrarModal('modalProspecto');
                mostrarAviso('Negocio cargado en el CRM.', 'ok');
                setTimeout(() => abrirFichaProspecto(ref.id), 350);
            }
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo guardar. Probá de nuevo.', 'error');
        }
    });
};

window.confirmarEliminarProspecto = function() {
    if (!esAdmin) return;
    const p = prospectosData.find(x => x.id === document.getElementById('prospecto-id').value);
    if (!p) return;
    prospectoAEliminar = p.id;
    document.getElementById('texto-eliminar-prospecto').innerText = p.etapa === 'cliente'
        ? `Se borra la ficha de ${datosProspecto(p).nombre} y su historial comercial. El cliente sigue en Mayorista con sus pedidos. No se puede deshacer.`
        : `Se borra ${p.nombre} y todo su historial. No se puede deshacer. Si no está interesado, mejor pasalo a "Descartado".`;
    abrirConfirmacion('modalConfirmDeleteProspecto');
};

window.cerrarConfirmDeleteProspecto = function() {
    cerrarConfirmacion('modalConfirmDeleteProspecto', () => { prospectoAEliminar = null; });
};

window.eliminarProspecto = async function() {
    if (!esAdmin || !prospectoAEliminar) return;
    await conBotonBloqueadoClick(document.getElementById('btn-confirm-delete-prospecto'), async () => {
        try {
            await borrarDoc(documento('prospectos', prospectoAEliminar));
            cerrarConfirmDeleteProspecto();
            cerrarModal('modalProspecto');
            cerrarFichaProspecto();
            mostrarAviso('Negocio eliminado del CRM.', 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo eliminar. Probá de nuevo.', 'error');
        }
    });
};

// ----- Registrar contacto, cambiar etapa y reactivar -----
function renderCanalesCrm(elegido) {
    document.getElementById('movimiento-canal').value = elegido;
    document.getElementById('movimiento-canales').innerHTML = Object.entries(CANALES_CRM).map(([valor, c]) => {
        const activo = valor === elegido;
        return `<button type="button" onclick="elegirCanalCrm('${valor}')" class="flex flex-col items-center gap-1 py-2 rounded-xl border-2 text-[10px] font-bold transition-all ${activo ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-gray-200 text-gray-500'}"><i class="${c.icono} text-base"></i>${c.texto}</button>`;
    }).join('');
}

window.elegirCanalCrm = function(canal) {
    renderCanalesCrm(canal);
};

const opcionesEtapaHtml = (opciones, actual) => opciones.map(([valor, texto]) => `<option value="${valor}">${texto}${valor === actual ? ' (actual)' : ''}</option>`).join('');

window.abrirMovimientoCrm = function(id, modo) {
    if (!esAdmin) return;
    const p = prospectosData.find(x => x.id === id);
    if (!p) return;
    const actual = valorEtapa(p);
    movimientoCrm = { id, modo, noInteresado: false };

    document.getElementById('titulo-movimiento-crm').innerText = { contacto: 'Registrar contacto', etapa: 'Cambiar etapa', reactivar: 'Reactivar negocio' }[modo];
    document.getElementById('movimiento-negocio').innerHTML = `${escaparHtml(datosProspecto(p).nombre)} · ${chipEtapa(p)}`;
    document.getElementById('movimiento-contacto-box').classList.toggle('hidden', modo !== 'contacto');
    document.getElementById('movimiento-nota-box').classList.toggle('hidden', modo === 'contacto');

    const fecha = document.getElementById('movimiento-fecha');
    fecha.value = fechaAInput(new Date());
    fecha.max = fechaAInput(new Date());
    document.getElementById('movimiento-resumen').value = '';
    document.getElementById('movimiento-nota').value = '';
    renderCanalesCrm(p.canal || 'whatsapp');

    const select = document.getElementById('movimiento-etapa');
    if (modo === 'reactivar') {
        select.innerHTML = opcionesEtapaHtml(OPCIONES_ETAPA_EN_CURSO, actual);
        select.value = OPCIONES_ETAPA_EN_CURSO.some(([valor]) => valor === p.etapaPrevia) ? p.etapaPrevia : 'contactado';
    } else {
        select.innerHTML = opcionesEtapaHtml(OPCIONES_ETAPA, actual);
        // si recién se lo contacta por primera vez, se sugiere pasarlo a "Contactado"
        select.value = modo === 'contacto' && p.etapa === 'nuevo' ? 'contactado' : actual;
    }
    document.getElementById('movimiento-etapa-box').classList.toggle('hidden', p.etapa === 'cliente');

    // al registrar un contacto el seguimiento anterior ya se cumplió; al cambiar etapa se conserva
    document.getElementById('movimiento-proximo').value = modo === 'contacto' ? '' : fechaAInput(p.proximoSeguimiento);
    document.getElementById('movimiento-paso').value = modo === 'contacto' ? '' : (p.proximoPaso || '');
    actualizarFormMovimientoCrm();
    abrirModal('modalMovimientoCrm');
};

function actualizarFormMovimientoCrm() {
    const p = prospectosData.find(x => x.id === movimientoCrm.id);
    const valor = document.getElementById('movimiento-etapa').value;
    document.getElementById('movimiento-no-interesado').classList.toggle('hidden', valor !== 'evaluacion:no_interesado');
    document.getElementById('movimiento-motivo').classList.toggle('hidden', !movimientoCrm.noInteresado);
    document.getElementById('movimiento-seguimiento-box').classList.toggle('hidden', p?.etapa === 'cliente' || valor === 'descartado');
}

window.cambioEtapaMovimiento = function() {
    movimientoCrm.noInteresado = false;
    actualizarFormMovimientoCrm();
};

window.resolverNoInteresado = function(destino) {
    document.getElementById('movimiento-etapa').value = destino;
    movimientoCrm.noInteresado = true;
    actualizarFormMovimientoCrm();
};

window.fijarProximoCrm = function(dias) {
    document.getElementById('movimiento-proximo').value = dias === null ? '' : fechaAInput(sumarDias(dias));
};

window.guardarMovimientoCrm = async function(e) {
    e.preventDefault();
    if (!esAdmin) return;
    const { id, modo, noInteresado } = movimientoCrm;
    const p = prospectosData.find(x => x.id === id);
    if (!p) return;
    const esCliente = p.etapa === 'cliente';
    const valor = esCliente ? valorEtapa(p) : document.getElementById('movimiento-etapa').value;
    const cambiaEtapa = valor !== valorEtapa(p);
    const resumen = document.getElementById('movimiento-resumen').value.trim();
    const fechaInput = document.getElementById('movimiento-fecha').value;

    if (valor === 'evaluacion:no_interesado') { mostrarAviso('Elegí si pasa a En pausa o a Descartado.', 'error'); return; }
    if (modo === 'contacto' && !fechaInput) { mostrarAviso('Elegí la fecha del contacto.', 'error'); return; }
    if (modo === 'contacto' && !resumen) { mostrarAviso('Contá brevemente qué pasó.', 'error'); return; }
    if (modo !== 'contacto' && !cambiaEtapa) { mostrarAviso('Elegí una etapa distinta a la actual.', 'error'); return; }

    await conBotonBloqueado(e, async () => {
        const [etapa, situacion = null] = valor.split(':');
        const fecha = modo === 'contacto' ? fechaElegida(fechaInput) : new Date();
        const sinSeguimiento = ETAPAS_SIN_SEGUIMIENTO.includes(etapa);
        const proximo = sinSeguimiento ? null : inputAFecha(document.getElementById('movimiento-proximo').value);
        const paso = sinSeguimiento ? '' : document.getElementById('movimiento-paso').value.trim();
        const canal = document.getElementById('movimiento-canal').value;

        const nuevas = [];
        if (modo === 'contacto') nuevas.push({ tipo: 'contacto', fecha, canal, resumen, proximoPaso: paso, proximaFecha: proximo });
        if (cambiaEtapa) nuevas.push({
            tipo: 'etapa', fecha, de: p.etapa, situacionDe: p.situacion || null, a: etapa, situacion,
            motivo: noInteresado ? 'no_interesado' : null,
            nota: modo === 'contacto' ? '' : document.getElementById('movimiento-nota').value.trim()
        });

        const cambios = { interacciones: [...(p.interacciones || []), ...nuevas], proximoSeguimiento: proximo, proximoPaso: paso };
        if (cambiaEtapa) {
            cambios.etapa = etapa;
            cambios.situacion = situacion;
            // al pausar o descartar se recuerda dónde estaba, para reactivarlo en esa etapa
            if (['pausa', 'descartado'].includes(etapa) && ETAPAS_EN_CURSO.includes(p.etapa)) cambios.etapaPrevia = valorEtapa(p);
        }
        if (modo === 'contacto' && !p.canal) cambios.canal = canal;

        try {
            await actualizarDoc(documento('prospectos', id), cambios);
            cerrarModal('modalMovimientoCrm');
            mostrarAviso({ contacto: 'Contacto registrado.', etapa: 'Etapa actualizada.', reactivar: 'Negocio reactivado.' }[modo], 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo guardar. Probá de nuevo.', 'error');
        }
    });
};

// ----- Conversión a cliente mayorista -----
window.abrirConvertirProspecto = function(id) {
    if (!esAdmin) return;
    const p = prospectosData.find(x => x.id === id);
    if (!p || p.etapa === 'cliente') return;
    conversionCrm = { id, destino: null, forzarNuevo: false };
    document.getElementById('convertir-nombre').value = p.nombre || '';
    document.getElementById('convertir-telefono').value = p.telefono || '';
    document.getElementById('convertir-dias-aviso').value = '';
    const variedades = nombresVariedades(p);
    document.getElementById('convertir-notas').value = [variedades.length ? `Le interesa: ${variedades.join(', ')}` : '', p.volumen ? `Volumen: ${p.volumen}` : ''].filter(Boolean).join(' · ');
    document.getElementById('convertir-descuento-btns').innerHTML = DESCUENTOS.map(d =>
        `<button type="button" data-valor="${d}" onclick="elegirDescuento('convertir', ${d})" class="desc-btn-convertir">${d ? d + '%' : 'Sin desc.'}</button>`
    ).join('');
    elegirDescuento('convertir', 0);
    actualizarCoincidenciaConversion();
    abrirModal('modalConvertirProspecto');
};

// busca si el negocio ya existe en Mayorista: primero por WhatsApp, después por nombre
const coincidenciaConversion = () => {
    const tel = normalizarTelefono(document.getElementById('convertir-telefono').value);
    const porTelefono = tel && mayoristasData.find(m => normalizarTelefono(m.telefono) === tel);
    if (porTelefono) return { cliente: porTelefono, por: 'telefono' };
    const nombre = normalizarTexto(document.getElementById('convertir-nombre').value);
    const porNombre = nombre && mayoristasData.find(m => normalizarTexto(m.nombre) === nombre);
    return porNombre ? { cliente: porNombre, por: 'nombre' } : null;
};

window.actualizarCoincidenciaConversion = function() {
    const c = coincidenciaConversion();
    const vincular = !!c && (c.por === 'telefono' || !conversionCrm.forzarNuevo);
    conversionCrm.destino = vincular ? c.cliente.id : null;

    const box = document.getElementById('convertir-coincidencia');
    box.classList.toggle('hidden', !c);
    if (c) {
        const quien = `<b>${escaparHtml(c.cliente.nombre)}</b>${c.cliente.telefono ? ` (${escaparHtml(c.cliente.telefono)})` : ''}`;
        const otraFicha = prospectosData.find(p => p.mayoristaId === c.cliente.id && p.id !== conversionCrm.id);
        const avisoFicha = otraFicha ? `<p class="mt-2 text-[11px] font-bold">Ojo: ese cliente ya está vinculado con otra ficha del CRM (${escaparHtml(otraFicha.nombre)}).</p>` : '';
        const opcion = (nuevo, texto) => `<button type="button" onclick="elegirModoConversion(${nuevo})" class="py-2 rounded-lg text-xs font-bold border ${conversionCrm.forzarNuevo === nuevo ? 'bg-amber-600 border-amber-600 text-white' : 'bg-white border-amber-200 text-amber-800'}">${texto}</button>`;
        box.innerHTML = c.por === 'telefono'
            ? `<div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900"><i class="fa-solid fa-link mr-1"></i>Ese WhatsApp ya es del cliente ${quien}. Se va a <b>vincular con ese cliente</b>, sin crear otro.${avisoFicha}</div>`
            : `<div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900"><p class="mb-2"><i class="fa-solid fa-circle-question mr-1"></i>Ya hay un cliente llamado ${quien}. ¿Es el mismo negocio?</p><div class="grid grid-cols-2 gap-2">${opcion(false, 'Sí, vincular')}${opcion(true, 'No, crear otro')}</div>${avisoFicha}</div>`;
    }
    document.getElementById('convertir-condiciones').classList.toggle('hidden', vincular);
    document.getElementById('convertir-submit').innerText = vincular ? 'Vincular con ese cliente' : 'Crear cliente mayorista';
};

window.elegirModoConversion = function(nuevo) {
    conversionCrm.forzarNuevo = nuevo;
    actualizarCoincidenciaConversion();
};

window.confirmarConversion = async function(e) {
    e.preventDefault();
    if (!esAdmin) return;
    const p = prospectosData.find(x => x.id === conversionCrm.id);
    if (!p) return;
    await conBotonBloqueado(e, async () => {
        // se vuelve a buscar justo antes de guardar, por si el panel mayorista cambió
        actualizarCoincidenciaConversion();
        const nombre = document.getElementById('convertir-nombre').value.trim();
        try {
            let clienteId = conversionCrm.destino;
            let nombreCliente = nombre;
            let nota;
            if (clienteId) {
                nombreCliente = mayoristasData.find(m => m.id === clienteId)?.nombre || nombre;
                nota = `Se vinculó con el cliente que ya existía: ${nombreCliente}`;
            } else {
                const diasAviso = parseInt(document.getElementById('convertir-dias-aviso').value, 10);
                const ref = await crearDoc(coleccion('mayoristas'), {
                    nombre,
                    telefono: document.getElementById('convertir-telefono').value.trim(),
                    descuento: Number(document.getElementById('convertir-descuento').value) || 0,
                    diasAviso: diasAviso > 0 ? diasAviso : null,
                    notas: document.getElementById('convertir-notas').value.trim(),
                    creado: new Date()
                });
                clienteId = ref.id;
                nota = 'Se creó como cliente nuevo en Mayorista';
            }
            const ahora = new Date();
            await actualizarDoc(documento('prospectos', p.id), {
                etapa: 'cliente',
                situacion: null,
                mayoristaId: clienteId,
                fechaConversion: ahora,
                proximoSeguimiento: null,
                proximoPaso: '',
                interacciones: [...(p.interacciones || []), { tipo: 'conversion', fecha: ahora, de: p.etapa, nota }]
            });
            cerrarModal('modalConvertirProspecto');
            mostrarAviso(`¡${escaparHtml(nombreCliente)} ya es cliente mayorista!`, 'ok');
        } catch (error) {
            console.error(error);
            mostrarAviso('No se pudo guardar. Probá de nuevo.', 'error');
        }
    });
};

function refrescarTodo() {
    renderBalanceYResumen();
    renderVentas();
    renderGastos();
    renderProveedores();
    renderHistorial();
    renderMayorista();
    renderAlertasInicio();
    if (!document.getElementById('content-balances').classList.contains('hidden')) renderGridBalances();
    if (pedidoDetalleAbierto) renderDetallePedido();
    if (historialContactoAbierto) renderHistorialContacto();
    renderCrm();
    renderAlertaCrm();
    if (prospectoAbierto) renderFichaProspecto();
}

const usuarioAEmail = (usuario) => {
    const u = usuario.trim().toLowerCase();
    return u.includes('@') ? u : `${u}@${dominioAuth}`;
};

const MENSAJES_ERROR_LOGIN = {
    'auth/invalid-credential': 'Usuario o contraseña incorrectos.',
    'auth/wrong-password': 'Usuario o contraseña incorrectos.',
    'auth/user-not-found': 'Usuario o contraseña incorrectos.',
    'auth/invalid-email': 'Usuario o contraseña incorrectos.',
    'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos y probá de nuevo.',
    'auth/network-request-failed': 'Sin conexión a internet. Revisá tu conexión.',
    'auth/operation-not-allowed': 'El inicio de sesión no está activado en Firebase.'
};

window.iniciarSesion = async function(e) {
    e.preventDefault();
    const boton = document.getElementById('login-boton');
    const errorEl = document.getElementById('login-error');
    errorEl.classList.add('hidden');
    boton.disabled = true;
    boton.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Ingresando...';
    try {
        await signInWithEmailAndPassword(auth, usuarioAEmail(document.getElementById('login-usuario').value), document.getElementById('login-clave').value);
    } catch (error) {
        console.error(error);
        errorEl.innerText = MENSAJES_ERROR_LOGIN[error.code] || 'No se pudo iniciar sesión. Intentá de nuevo.';
        errorEl.classList.remove('hidden');
        document.getElementById('login-clave').value = '';
    } finally {
        boton.disabled = false;
        boton.innerText = 'Ingresar';
    }
};

window.cerrarSesion = async function() {
    if (!confirm('¿Cerrar sesión en este dispositivo?')) return;
    await signOut(auth);
    location.reload();
};

window.alternarVerClave = function() {
    const input = document.getElementById('login-clave');
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    document.getElementById('login-ojo').className = `fa-solid ${mostrar ? 'fa-eye-slash' : 'fa-eye'}`;
};

function mostrarLogin(visible) {
    document.getElementById('login-cargando').classList.add('hidden');
    document.getElementById('form-login').classList.toggle('hidden', !visible);
    document.getElementById('pantalla-login').classList.toggle('hidden', visible === false);
}

let datosIniciados = false;

// en modo prueba, ?prueba&admin muestra la vista de admin (los cambios igual quedan en memoria)
const esCuentaAdmin = (user) => user.email === `admin@${dominioAuth}` || (MODO_PRUEBA && new URLSearchParams(location.search).has('admin'));

function aplicarPermisos() {
    document.getElementById('chip-admin').classList.toggle('hidden', !esAdmin);
    document.querySelectorAll('.solo-admin').forEach(el => {
        el.classList.toggle('hidden', !esAdmin);
        el.classList.toggle('flex', esAdmin);
    });
    // el admin tiene un botón más en la barra (CRM): se achican márgenes para que entren las 9 etiquetas
    const barra = document.getElementById('barra-nav');
    barra.classList.toggle('grid-cols-8', !esAdmin);
    barra.classList.toggle('grid-cols-9', esAdmin);
    barra.classList.toggle('gap-0.5', !esAdmin);
    barra.classList.toggle('px-1', !esAdmin);
    barra.classList.toggle('px-0.5', esAdmin);
    barra.querySelectorAll('.nav-btn span:not([id])').forEach(etiqueta => {
        etiqueta.classList.toggle('tracking-tight', !esAdmin);
        etiqueta.classList.toggle('tracking-tighter', esAdmin);
    });
}

function inicializar() {
    inicializarBotonesDescuento();
    cambiarVistaBalance('mes');
    // la sesión anónima de pedido.html no sirve para entrar acá
    onAuthStateChanged(auth, (user) => {
        if (user && !user.isAnonymous) {
            esAdmin = esCuentaAdmin(user);
            aplicarPermisos();
            mostrarLogin(false);
            if (!datosIniciados) {
                datosIniciados = true;
                cargarDatos();
            }
        } else {
            if (datosIniciados) { location.reload(); return; }
            mostrarLogin(true);
        }
    });
}

function cargarDatos() {
    try {
        const ventasRef = coleccion('ventas');
        const gastosRef = coleccion('gastos');
        const productosRef = coleccion('productos');

        escuchar(productosRef, (snapshot) => {
            productosData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            productosData.sort((a, b) => a.nombre.localeCompare(b.nombre));
            renderProductos();
        });

        escuchar(ventasRef, (snapshot) => {
            const todas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            ventasData = todas.filter(v => !v.eliminado);
            ventasEliminadas = todas.filter(v => v.eliminado);
            refrescarTodo();
        });

        escuchar(gastosRef, (snapshot) => {
            const todos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            gastosData = todos.filter(g => !g.eliminado);
            gastosEliminados = todos.filter(g => g.eliminado);
            refrescarTodo();
        });

        escuchar(coleccion('proveedores'), (snapshot) => {
            proveedoresData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            proveedoresData.sort((a, b) => a.nombre.localeCompare(b.nombre));
            refrescarTodo();
        });

        escuchar(coleccion('mayoristas'), (snapshot) => {
            mayoristasData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            refrescarTodo();
        });

        escuchar(coleccion('pedidos'), (snapshot) => {
            pedidosData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            refrescarTodo();
        });

        // el CRM solo lo lee la cuenta admin
        if (esAdmin) {
            escuchar(coleccion('prospectos'), (snapshot) => {
                prospectosData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                estadoCrm = 'listo';
                refrescarTodo();
            }, (error) => {
                console.error(error);
                estadoCrm = 'error';
                renderCrm();
            });
        }
    } catch (error) {
        console.error("Error inicializando Firebase:", error);
    }
}

inicializar();
