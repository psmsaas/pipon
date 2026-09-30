import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { addDoc, onSnapshot, updateDoc, getDocs, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { auth, dominioAuth, coleccion, documento } from './firebase.js';
import { formatearDinero, escaparHtml, modoPrueba, mostrarAviso, bannerPrueba } from './utils.js';

// con ?prueba se leen los datos reales pero los cambios quedan en memoria
const MODO_PRUEBA = modoPrueba();
let crearDoc = addDoc;
let actualizarDoc = updateDoc;
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
    escuchar = (refColeccion, cb) => {
        (oyentes[refColeccion.path] ||= []).push(cb);
        asegurar(refColeccion).then(() => emitir(refColeccion.path));
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
    bannerPrueba('Nada de lo que cargues se guarda');
}

let ventasData = [];
let gastosData = [];
let productosData = [];
let mayoristasData = [];
let pedidosData = [];

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

// un pedido mayorista entra como ingreso el día que se entrega
const ventasMayoristasEntregadas = () => pedidosData
    .filter(p => p.estado === 'entregado' && p.fechaEntrega)
    .map(p => ({ ...p, monto: p.total, timestamp: p.fechaEntrega, tipo: 'mayorista' }));
const todosLosIngresos = () => [...ventasData, ...ventasMayoristasEntregadas()];

function renderBalanceYResumen() {
    const ingresos = todosLosIngresos();
    const ventasHoy = ingresos.filter(v => esHoy(v.timestamp));
    const gastosHoy = gastosData.filter(g => esHoy(g.timestamp));

    const totalVentasHoy = ventasHoy.reduce((sum, v) => sum + Number(v.monto), 0);
    const totalGastosHoy = gastosHoy.reduce((sum, g) => sum + Number(g.monto), 0);
    const balanceTotalHoy = totalVentasHoy - totalGastosHoy;

    document.getElementById('resumen-ingresos').innerText = formatearDinero(totalVentasHoy);
    document.getElementById('resumen-gastos').innerText = formatearDinero(totalGastosHoy);

    const balEl = document.getElementById('balance-total');
    balEl.innerText = formatearDinero(balanceTotalHoy);
    if (balanceTotalHoy > 0) balEl.className = 'text-5xl font-black text-green-600 mb-1';
    else if (balanceTotalHoy < 0) balEl.className = 'text-5xl font-black text-red-600 mb-1';
    else balEl.className = 'text-5xl font-black text-pipon-brown mb-1';

    const ventasAyer = ingresos.filter(v => esAyer(v.timestamp));
    const gastosAyer = gastosData.filter(g => esAyer(g.timestamp));
    const totalVentasAyer = ventasAyer.reduce((sum, v) => sum + Number(v.monto), 0);
    const totalGastosAyer = gastosAyer.reduce((sum, g) => sum + Number(g.monto), 0);
    const balanceTotalAyer = totalVentasAyer - totalGastosAyer;

    const balAyerEl = document.getElementById('balance-ayer');
    if (totalVentasAyer === 0 && totalGastosAyer === 0) {
        balAyerEl.innerText = `Ayer: Sin movimientos`;
        balAyerEl.className = 'text-sm font-semibold text-gray-400';
    } else {
        balAyerEl.innerText = `Ayer: ${formatearDinero(balanceTotalAyer)}`;
        if (balanceTotalAyer > 0) balAyerEl.className = 'text-sm font-bold text-green-500';
        else if (balanceTotalAyer < 0) balAyerEl.className = 'text-sm font-bold text-red-500';
        else balAyerEl.className = 'text-sm font-bold text-gray-500';
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
            <span class="font-black text-green-600 text-lg">+${formatearDinero(v.monto)}</span>
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
                <div class="flex items-center gap-2 mt-1">
                    <span class="text-xs text-gray-400"><i class="fa-regular fa-clock"></i> ${formatearHora(g.timestamp)}</span>
                    <span class="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">${g.metodo}</span>
                    ${g.comprobante ? `<button onclick="verComprobante('${g.id}', 'gastos')" class="text-[10px] bg-blue-50 text-blue-500 px-2 py-0.5 rounded flex items-center gap-1 hover:bg-blue-100"><i class="fa-solid fa-paperclip"></i> Ver</button>` : ''}
                </div>
            </div>
            <span class="font-black text-red-600 text-lg">-${formatearDinero(g.monto)}</span>
        </div>
    `).join('');
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
        if(!dias[fecha]) dias[fecha] = { minorista: 0, cantMinorista: 0, mayorista: 0, contactosMayorista: new Set(), unidadesMayorista: 0, gastos: 0 };
        return dias[fecha];
    };
    ventasData.forEach(v => {
        const dia = diaDe(v);
        if (!dia) return;
        dia.minorista += Number(v.monto);
        dia.cantMinorista += 1;
    });
    ventasMayoristasEntregadas().forEach(p => {
        const dia = diaDe(p);
        if (!dia) return;
        dia.mayorista += Number(p.monto);
        dia.contactosMayorista.add(claveContactoPedido(p));
        dia.unidadesMayorista += Number(p.unidades) || 0;
    });
    gastosData.forEach(g => {
        const dia = diaDe(g);
        if (dia) dia.gastos += Number(g.monto);
    });
    return dias;
}

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
    if (!diaSeleccionadoFormat) {
        cuadroEl.classList.add('hidden');
        return;
    }
    cuadroEl.classList.remove('hidden');
    const infoDia = datosAgrupados[diaSeleccionadoFormat] || { minorista: 0, cantMinorista: 0, mayorista: 0, contactosMayorista: new Set(), unidadesMayorista: 0, gastos: 0 };
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
    }
    if(modalId === 'modalGasto') {
        document.getElementById('form-gasto').reset();
        limpiarImagen('gasto');
        document.getElementById('gasto-metodo').value = "Efectivo";
        document.querySelectorAll('.metodo-btn-gasto')[0].className = "metodo-btn-gasto border-2 border-red-500 bg-red-50 text-red-700 font-bold py-3 rounded-xl transition-all";
        document.querySelectorAll('.metodo-btn-gasto')[1].className = "metodo-btn-gasto border-2 border-gray-200 text-gray-500 font-bold py-3 rounded-xl transition-all";
    }
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

window.guardarVenta = async function(e) {
    e.preventDefault();
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
        const data = { monto: Number(monto), descripcion: desc, metodo: metodo, timestamp: new Date() };
        if(comprobante) data.comprobante = comprobante;

        await crearDoc(ventasRef, data);
        cerrarModal('modalVenta');
        mostrarAviso('Venta guardada.', 'ok');
    } catch (error) {
        console.error(error);
        mostrarAviso('No se pudo guardar. Probá de nuevo.', 'error');
    }
};

window.guardarGasto = async function(e) {
    e.preventDefault();
    const monto = document.getElementById('gasto-monto').value;
    const desc = document.getElementById('gasto-desc').value;
    const metodo = document.getElementById('gasto-metodo').value;
    const comprobante = document.getElementById('gasto-comprobante-base64').value;

    try {
        const gastosRef = coleccion('gastos');
        const data = { monto: Number(monto), descripcion: desc, metodo: metodo, timestamp: new Date() };
        if(comprobante) data.comprobante = comprobante;

        await crearDoc(gastosRef, data);
        cerrarModal('modalGasto');
        mostrarAviso('Gasto registrado correctamente.', 'ok');
    } catch (error) {
        console.error(error);
        mostrarAviso('No se pudo guardar. Probá de nuevo.', 'error');
    }
};

window.guardarProducto = async function(e) {
    e.preventDefault();
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
    abrirModal('modalContacto');
};

window.guardarContacto = async function(e) {
    e.preventDefault();
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

function refrescarTodo() {
    renderBalanceYResumen();
    renderVentas();
    renderGastos();
    renderHistorial();
    renderMayorista();
    renderAlertasInicio();
    if (!document.getElementById('content-balances').classList.contains('hidden')) renderGridBalances();
    if (pedidoDetalleAbierto) renderDetallePedido();
    if (historialContactoAbierto) renderHistorialContacto();
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

function inicializar() {
    inicializarBotonesDescuento();
    // la sesión anónima de pedido.html no sirve para entrar acá
    onAuthStateChanged(auth, (user) => {
        if (user && !user.isAnonymous) {
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
            ventasData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            refrescarTodo();
        });

        escuchar(gastosRef, (snapshot) => {
            gastosData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
    } catch (error) {
        console.error("Error inicializando Firebase:", error);
    }
}

inicializar();
