import { combinarTextosWeb } from './textos-web.js';

// los textos que guarda la cuenta admin desde el sistema (Configuración → Web de Pipón).
// Se leen sin iniciar sesión: la regla de Firebase solo permite leer este documento.
const URL_TEXTOS_GUARDADOS = 'https://firestore.googleapis.com/v1/projects/sistema-pipon/databases/(default)/documents/negocio/pipon/ajustes/web?key=AIzaSyBjzZmNyG_NmfNlEc3QusG55YLYIUwXIQY';

const $ = (selector, raiz = document) => raiz.querySelector(selector);
const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];

// ----- Textos guardados -----
// Firestore devuelve cada valor con su tipo ({ stringValue: ... }); lo pasamos a valores comunes
const desdeFirestore = (v) => {
    if (!v || typeof v !== 'object') return undefined;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(desdeFirestore);
    if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, desdeFirestore(x)]));
    return undefined;
};

// si no hay nada guardado, no hay conexión o tarda demasiado, quedan los textos base
async function leerTextosGuardados() {
    const corte = new AbortController();
    const espera = setTimeout(() => corte.abort(), 3500);
    try {
        const respuesta = await fetch(URL_TEXTOS_GUARDADOS, { signal: corte.signal, cache: 'no-store' });
        if (!respuesta.ok) return null;
        const doc = await respuesta.json();
        return desdeFirestore({ mapValue: { fields: doc.fields || {} } });
    } catch {
        return null;
    } finally {
        clearTimeout(espera);
    }
}

let textos = combinarTextosWeb(await leerTextosGuardados());

// ----- Pintar los textos en la página -----
const elemento = (etiqueta, clase, texto) => {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto !== undefined) el.textContent = texto;
    return el;
};
const icono = (clases) => {
    const i = document.createElement('i');
    i.className = clases;
    return i;
};

// escribe el texto y pinta de color la primera vez que aparece la palabra resaltada
const conResaltado = (destino, texto, resaltado, etiqueta, clase = '') => {
    destino.textContent = '';
    const desde = resaltado ? texto.indexOf(resaltado) : -1;
    if (desde < 0) { destino.append(texto); return; }
    destino.append(texto.slice(0, desde), elemento(etiqueta, clase, resaltado), texto.slice(desde + resaltado.length));
};

const ICONOS_NEGOCIO = [
    [/drug/i, 'fa-store'], [/kiosc/i, 'fa-shop'], [/almac/i, 'fa-basket-shopping'], [/despens|super/i, 'fa-cart-shopping'],
    [/caf/i, 'fa-mug-hot'], [/escuel|colegio|escolar/i, 'fa-school'], [/buffet|cantina|resto|bar\b/i, 'fa-utensils'],
    [/estaci|servicio|combust/i, 'fa-gas-pump'], [/gim/i, 'fa-dumbbell'], [/mayor|distrib/i, 'fa-boxes-stacked']
];
const iconoNegocio = (tipo) => (ICONOS_NEGOCIO.find(([patron]) => patron.test(tipo)) || [null, 'fa-store'])[1];

// cada carril tiene el contenido dos veces seguidas: así la animación vuelve al principio sin saltos
const llenarCarril = (carril, tipos) => {
    carril.textContent = '';
    carril.hidden = !tipos.length;
    if (!tipos.length) return;
    const vueltas = Math.ceil(12 / tipos.length);
    for (let mitad = 0; mitad < 2; mitad++) {
        for (let v = 0; v < vueltas; v++) {
            tipos.forEach(tipo => {
                const chip = elemento('span', 'chip');
                chip.append(icono(`fa-solid ${iconoNegocio(tipo)}`), tipo);
                carril.append(chip);
            });
        }
    }
};

const TEMAS_CAPITULO = ['naranja', 'amarillo', 'marron', 'blanco'];

function pintarTextos(t) {
    $('#web-bajada').textContent = t.portada.bajada;
    $('#web-bajada').parentElement.hidden = !t.portada.bajada;
    $('#web-hola').textContent = t.portada.hola;

    const cinta = $('#web-cinta');
    cinta.textContent = '';
    for (let i = 0; i < 3; i++) {
        const tramo = elemento('span');
        t.cinta.forEach(frase => tramo.append(`${frase} `, icono('fa-solid fa-star'), ' '));
        cinta.append(tramo);
    }

    conResaltado($('#web-historia-titulo'), t.historia.titulo, t.historia.resaltado, 'em');
    const lista = $('#web-capitulos');
    lista.textContent = '';
    t.historia.capitulos.forEach((c, i) => {
        const item = elemento('li', 'capitulo');
        item.dataset.tema = TEMAS_CAPITULO[i % TEMAS_CAPITULO.length];
        const punto = elemento('span', 'capitulo-punto');
        punto.setAttribute('aria-hidden', 'true');
        const cuerpo = elemento('div', 'capitulo-cuerpo');
        if (c.etiqueta) cuerpo.append(elemento('span', 'capitulo-anio', c.etiqueta));
        cuerpo.append(elemento('h3', '', c.titulo), elemento('p', '', c.texto));
        item.append(punto, cuerpo);
        lista.append(item);
    });
    $('#medallon-total').textContent = t.historia.capitulos.length;

    conResaltado($('#web-frase'), t.frase.texto, t.frase.resaltado, 'span', 'resaltada');

    conResaltado($('#web-negocio-titulo'), t.negocio.titulo, t.negocio.resaltado, 'em');
    $('#web-negocio-intro').textContent = t.negocio.intro;
    const mitad = t.negocio.tipos.length < 4 ? t.negocio.tipos.length : Math.ceil(t.negocio.tipos.length / 2);
    llenarCarril($('#web-carril-1'), t.negocio.tipos.slice(0, mitad));
    llenarCarril($('#web-carril-2'), t.negocio.tipos.slice(mitad));

    const pasos = $('#web-pasos');
    pasos.textContent = '';
    t.negocio.pasos.forEach((paso, i) => {
        const item = elemento('li', 'paso');
        const cuerpo = elemento('div');
        cuerpo.append(elemento('h3', '', paso.titulo), elemento('p', '', paso.texto));
        item.append(elemento('span', 'paso-num', String(i + 1)), cuerpo);
        pasos.append(item);
    });

    $('#web-ciudad').textContent = t.pie.ciudad;
    $('#web-ciudad').hidden = !t.pie.ciudad;
}

pintarTextos(textos);
$('#anio').textContent = new Date().getFullYear();

// ----- Cabecera: se vuelve sólida cuando la portada ya quedó cubierta -----
const cabecera = $('.cabecera');
const cinta = $('.cinta');
let portadaCubierta = false;

const actualizarCabecera = () => {
    const pasoLaPortada = cinta.getBoundingClientRect().top <= cabecera.offsetHeight;
    cabecera.classList.toggle('solida', portadaCubierta || pasoLaPortada);
};
addEventListener('scroll', actualizarCabecera, { passive: true });
addEventListener('resize', actualizarCabecera);
actualizarCabecera();

// ----- Formulario: arma el mensaje y abre WhatsApp, no guarda nada -----
const formulario = $('#quiero');
const avisoForm = $('#form-aviso');
const CAMPOS_OBLIGATORIOS = {
    negocio: 'el nombre del negocio',
    tipo: 'el tipo de negocio',
    nombre: 'tu nombre',
    direccion: 'la dirección'
};

const mostrarAvisoForm = (texto, tipo, enlace = null) => {
    avisoForm.className = `form-aviso ${tipo}`;
    avisoForm.textContent = texto;
    if (enlace) {
        const a = elemento('a', '', enlace.texto);
        a.href = enlace.url;
        a.target = '_blank';
        a.rel = 'noopener';
        avisoForm.append(' ', a, '.');
    }
};

formulario.addEventListener('input', (e) => {
    if (e.target.getAttribute('aria-invalid') === 'true' && e.target.value.trim()) e.target.removeAttribute('aria-invalid');
});

formulario.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries([...new FormData(formulario)].map(([clave, valor]) => [clave, String(valor).trim()]));

    const faltan = Object.keys(CAMPOS_OBLIGATORIOS).filter(clave => !datos[clave]);
    $$('[name]', formulario).forEach(campo => {
        if (faltan.includes(campo.name)) campo.setAttribute('aria-invalid', 'true');
        else campo.removeAttribute('aria-invalid');
    });
    if (faltan.length) {
        const lista = faltan.map(clave => CAMPOS_OBLIGATORIOS[clave]);
        const texto = lista.length > 1 ? `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}` : lista[0];
        mostrarAvisoForm(`Falta completar ${texto}.`, 'error');
        formulario.elements[faltan[0]].focus();
        return;
    }

    const mensaje = [
        '¡Hola Pipón! Quiero tener Pipón en mi negocio.',
        '',
        `• Negocio: ${datos.negocio} (${datos.tipo})`,
        `• Mi nombre: ${datos.nombre}`,
        `• Dirección: ${datos.direccion}`,
        datos.comentario ? `• Comentario: ${datos.comentario}` : null
    ].filter(linea => linea !== null).join('\n');
    const armarUrl = (numero) => `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;

    if (textos.whatsapp) {
        window.open(armarUrl(textos.whatsapp), '_blank', 'noopener');
        mostrarAvisoForm('¡Listo! Enviá el mensaje en WhatsApp. Si no se abrió,', 'ok', { texto: 'tocá acá', url: armarUrl(textos.whatsapp) });
        return;
    }

    // si al entrar no se pudo leer el número (ej: sin señal), lo intentamos de nuevo
    const boton = $('[type="submit"]', formulario);
    boton.disabled = true;
    mostrarAvisoForm('Un momento...', 'ok');
    const guardados = await leerTextosGuardados();
    boton.disabled = false;
    if (guardados) textos = combinarTextosWeb(guardados);
    if (textos.whatsapp) {
        // pasó un rato desde el toque, así que el navegador puede bloquear la ventana: dejamos el enlace
        mostrarAvisoForm('¡Listo!', 'ok', { texto: 'Tocá acá para abrir WhatsApp con tu mensaje', url: armarUrl(textos.whatsapp) });
    } else {
        mostrarAvisoForm('No pudimos cargar el WhatsApp de Pipón. Revisá tu conexión y probá de nuevo en un rato.', 'error');
    }
});

// ----- Animaciones con el scroll -----
const capitulos = $$('.capitulo');
const medallon = $('.medallon');
const GIROS_MEDALLON = [-6, 8, -4, 5];

const activarCapitulo = (indice) => {
    if (!medallon) return;
    medallon.dataset.tema = capitulos[indice].dataset.tema;
    medallon.firstElementChild.style.transform = `rotate(${GIROS_MEDALLON[indice % GIROS_MEDALLON.length]}deg) scale(${indice % 2 ? 1.06 : 1})`;
    $('#medallon-numero').textContent = indice + 1;
};

// separa la frase en palabras para pintarlas de a una
const separarPalabras = (destino) => {
    const nodos = [...destino.childNodes];
    destino.textContent = '';
    nodos.forEach(nodo => {
        if (nodo.nodeType === Node.TEXT_NODE) {
            nodo.textContent.split(/(\s+)/).forEach(parte => {
                if (!parte) return;
                if (/^\s+$/.test(parte)) { destino.append(' '); return; }
                destino.append(elemento('span', 'palabra', parte));
            });
        } else {
            nodo.classList.add('palabra');
            destino.append(nodo);
        }
    });
    return $$('.palabra', destino);
};

function iniciarAnimaciones() {
    const { gsap, ScrollTrigger } = window;
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });

    const palabrasFrase = separarPalabras($('.frase-texto'));
    const mm = gsap.matchMedia();

    mm.add({ movimiento: '(prefers-reduced-motion: no-preference)' }, ({ conditions }) => {
        if (!conditions.movimiento) {
            capitulos.forEach(c => c.classList.add('activo'));
            return;
        }

        // Entrada de la portada
        const entrada = gsap.timeline({ defaults: { ease: 'back.out(1.7)' } });
        entrada
            .from('.logo-meneo', { scale: .4, opacity: 0, rotate: -18, duration: 1 })
            .from('.portada-titulo .letra > span', { yPercent: 110, opacity: 0, stagger: .06, duration: .7 }, '-=.6')
            .from('.portada-bajada > span', { y: 20, opacity: 0, duration: .5, ease: 'power2.out' }, '-=.35')
            .from('.deslizar span', { opacity: 0, duration: .5 }, '-=.2')
            .from('.miga', { scale: 0, stagger: .05, duration: .5 }, '<');
        // el muñeco se mece suave todo el tiempo
        gsap.fromTo('.logo-meneo', { rotate: -3 }, { rotate: 3, duration: 1.8, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1 });

        // Portada fija mientras el círculo crema la cubre y el logo cambia de color
        const giros = [-24, 14, -10, 20, -16];
        gsap.timeline({
            scrollTrigger: {
                trigger: '.portada',
                start: 'top top',
                end: '+=120%',
                pin: true,
                scrub: .6,
                anticipatePin: 1,
                onUpdate: (self) => {
                    const cubierta = self.progress > .45;
                    if (cubierta !== portadaCubierta) { portadaCubierta = cubierta; actualizarCabecera(); }
                }
            }
        })
            .to('.deslizar', { opacity: 0, y: 20, duration: .12 }, 0)
            .to('.portada-titulo .letra', { y: () => -innerHeight * .28, rotate: i => giros[i], opacity: 0, stagger: .03, duration: .35, ease: 'power2.in' }, 0)
            .to('.portada-bajada', { y: -30, opacity: 0, duration: .2 }, 0)
            .to('.miga', { y: i => -innerHeight * (.15 + i * .06), duration: .6, ease: 'none' }, 0)
            .to('.portada-circulo', { scale: 1, duration: .38, ease: 'power2.in' }, .1)
            .to('.portada-logo', { color: '#5C260E', duration: .15 }, .1)
            .to('.portada-logo', { y: () => -innerHeight * .14, scale: .78, duration: .5, ease: 'power2.inOut' }, .3)
            .fromTo('.portada-hola', { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: .25 }, .62)
            .to({}, { duration: .15 });

        // Cinta: el texto y los cuadros corren en sentidos opuestos
        const cintaScroll = { trigger: '.cinta', start: 'top bottom', end: 'bottom top', scrub: true };
        gsap.fromTo('.cinta-pista', { xPercent: 0 }, { xPercent: -30, ease: 'none', scrollTrigger: cintaScroll });
        gsap.fromTo('.cuadros', { backgroundPositionX: 0 }, { backgroundPositionX: 256, ease: 'none', scrollTrigger: { ...cintaScroll } });

        // Títulos y textos que aparecen al llegar
        $$('.revelar').forEach(el => {
            gsap.from(el, { y: 50, opacity: 0, duration: .9, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
        });

        // Historia: la línea se llena y cada capítulo se enciende
        gsap.fromTo('.linea-relleno', { scaleY: 0 }, {
            scaleY: 1, ease: 'none',
            scrollTrigger: { trigger: '.linea-caja', start: 'top 60%', end: 'bottom 60%', scrub: true }
        });
        capitulos.forEach((capitulo, i) => {
            gsap.from($('.capitulo-cuerpo', capitulo), { y: 60, opacity: 0, duration: .9, ease: 'power3.out', scrollTrigger: { trigger: capitulo, start: 'top 85%', once: true } });
            ScrollTrigger.create({
                trigger: capitulo,
                start: 'top 60%',
                end: 'bottom 60%',
                onToggle: (self) => { if (self.isActive) activarCapitulo(i); },
                onEnter: () => capitulo.classList.add('activo'),
                onLeaveBack: () => capitulo.classList.remove('activo')
            });
        });

        // Frase: se pinta palabra por palabra y el muñeco gira
        gsap.fromTo(palabrasFrase, { opacity: .14 }, {
            opacity: 1, stagger: .1, ease: 'none',
            scrollTrigger: { trigger: '.frase-texto', start: 'top 82%', end: 'bottom 45%', scrub: true }
        });
        gsap.fromTo('.frase-logo', { rotate: -25, scale: .7 }, {
            rotate: 12, scale: 1.1, ease: 'none',
            scrollTrigger: { trigger: '.frase', start: 'top bottom', end: 'bottom top', scrub: true }
        });

        // Tu negocio: los pasos entran de a uno y el formulario sube
        gsap.from('.paso', { x: -40, opacity: 0, stagger: .15, duration: .7, ease: 'power3.out', scrollTrigger: { trigger: '.pasos', start: 'top 85%', once: true } });
        gsap.from('.formulario', { y: 80, rotate: 2, opacity: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '.formulario', start: 'top 92%', once: true } });

        return () => { portadaCubierta = false; actualizarCabecera(); };
    });

    // las letras cambian de tamaño al cargar la fuente: recalculamos posiciones
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

// la portada se muestra recién ahora, en el mismo instante en que arranca su animación
document.documentElement.classList.remove('cargando');
if (window.gsap && window.ScrollTrigger) {
    iniciarAnimaciones();
} else {
    // sin la librería la página se ve completa, solo que sin movimiento
    capitulos.forEach(c => c.classList.add('activo'));
}
