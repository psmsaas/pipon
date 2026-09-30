export const formatearDinero = (monto) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(monto);

export const escaparHtml = (texto) => String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const modoPrueba = () => new URLSearchParams(location.search).has('prueba');

export function mostrarAviso(mensaje, tipo = 'ok') {
    const toast = document.createElement('div');
    const ok = tipo === 'ok';
    toast.className = `toast ${ok ? 'bg-green-600' : 'bg-red-600'} text-white px-5 py-3 rounded-full shadow-lg font-bold text-sm flex items-center gap-2 pointer-events-auto`;
    toast.innerHTML = `<i class="fa-solid ${ok ? 'fa-check' : 'fa-info'}"></i> ${mensaje}`;
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => {
        toast.style.transition = 'all 0.3s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

export function bannerPrueba(texto) {
    document.body.insertAdjacentHTML('afterbegin', `<div class="bg-yellow-300 text-yellow-900 text-center text-[11px] font-black py-1 tracking-wider">MODO PRUEBA · ${texto}</div>`);
}
