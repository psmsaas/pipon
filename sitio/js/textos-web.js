// Textos de la web de Pipón. La cuenta admin los cambia desde el sistema (Configuración)
// y se guardan en negocio/pipon/ajustes/web; lo que no esté guardado usa estos.
// Lo usan la web (sitio/js/sitio.js) y el sistema (js/app.js): si cambian estos textos,
// cambiá también los que están escritos en sitio/index.html para que coincidan.

export const TEXTOS_WEB_BASE = {
    whatsapp: '',
    whatsappVisible: '',
    portada: {
        bajada: 'Rico de verdad, hecho en Concordia.',
        hola: 'Hola, somos Pipón.'
    },
    cinta: ['Hecho en Concordia', 'Con mucho amor', 'Pipón'],
    historia: {
        titulo: 'Nuestra historia',
        resaltado: 'historia',
        capitulos: [
            {
                etiqueta: '20XX',
                titulo: 'Cómo empezó',
                texto: 'Pipón nació en una cocina de Concordia, con una receta de familia y muchas ganas de compartirla. Al principio era para los amigos y los vecinos, hasta que empezaron a pedirnos más.'
            },
            {
                etiqueta: '¿Por qué Pipón?',
                titulo: 'Un nombre con panza llena',
                texto: 'Pipón es esa sensación de haber comido algo rico y quedar feliz. Eso es lo que buscamos en cada cosa que hacemos, y por eso nuestro muñeco abraza lo que más le gusta.'
            },
            {
                etiqueta: '20XX',
                titulo: 'Creciendo de a poco',
                texto: 'Los primeros kioscos del barrio confiaron en nosotros. Después llegaron los almacenes, los drugstores y los mayoristas, siempre con la misma receta y el mismo cuidado.'
            },
            {
                etiqueta: 'Hoy',
                titulo: 'Cada vez más cerca tuyo',
                texto: 'Hoy Pipón está en negocios de toda la ciudad y queremos seguir sumando puntos. Si tenés un comercio, el próximo podés ser vos.'
            }
        ]
    },
    frase: {
        texto: 'Comer rico, compartir y quedar bien pipón.',
        resaltado: 'pipón.'
    },
    negocio: {
        titulo: '¿Querés tener Pipón en tu negocio?',
        resaltado: 'Pipón',
        intro: 'Si tenés un drugstore, kiosco, almacén o cualquier comercio de Concordia, podés sumar Pipón a tus estantes. Mandanos tus datos por WhatsApp y coordinamos.',
        tipos: ['Drugstores', 'Kioscos', 'Almacenes', 'Despensas', 'Cafeterías', 'Buffets', 'Estaciones de servicio', 'Cantinas escolares', 'Gimnasios', 'Mayoristas'],
        pasos: [
            { titulo: 'Completás tus datos', texto: 'Nombre del negocio, qué tipo de comercio es y dónde queda.' },
            { titulo: 'Nos llega por WhatsApp', texto: 'Se abre WhatsApp con el mensaje armado. Solo tenés que enviarlo.' },
            { titulo: 'Coordinamos y listo', texto: 'Te respondemos para arreglar todo y Pipón llega a tu negocio.' }
        ]
    },
    pie: {
        ciudad: 'Concordia, Entre Ríos'
    }
};

export const LIMITES_WEB = {
    corto: 40,
    titulo: 80,
    texto: 400,
    cinta: 6,
    capitulos: 8,
    tipos: 16
};

const texto = (valor, base, max) => typeof valor === 'string' && valor.trim() ? valor.trim().slice(0, max) : base;
// los campos optativos pueden quedar vacíos a propósito (ej: sin palabra en color)
const optativo = (valor, base, max) => typeof valor === 'string' ? valor.trim().slice(0, max) : base;
const lista = (valor, base, max, armar) => {
    if (!Array.isArray(valor)) return base;
    const items = valor.map(armar).filter(Boolean).slice(0, max);
    return items.length ? items : base;
};

// la foto de un capítulo se guarda aparte (negocio/pipon/webfotos/{id}); acá solo queda la referencia
const fotoValida = (f) => {
    if (!f || typeof f.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(f.id)) return null;
    const ancho = Number(f.ancho), alto = Number(f.alto);
    if (!(ancho > 0 && alto > 0 && ancho <= 10000 && alto <= 10000)) return null;
    return { id: f.id, ancho, alto };
};

// mezcla lo guardado con los textos base, descartando lo que no tenga la forma esperada
export function combinarTextosWeb(guardado) {
    const g = guardado && typeof guardado === 'object' ? guardado : {};
    const b = TEXTOS_WEB_BASE;
    const L = LIMITES_WEB;
    const whatsapp = typeof g.whatsapp === 'string' && /^\d{10,15}$/.test(g.whatsapp) ? g.whatsapp : b.whatsapp;
    // copia aparte: quien lo use puede modificarlo sin tocar los textos base
    return structuredClone({
        whatsapp,
        whatsappVisible: whatsapp ? optativo(g.whatsappVisible, whatsapp, L.corto) : '',
        portada: {
            bajada: optativo(g.portada?.bajada, b.portada.bajada, L.titulo),
            hola: texto(g.portada?.hola, b.portada.hola, L.corto)
        },
        cinta: lista(g.cinta, b.cinta, L.cinta, f => typeof f === 'string' && f.trim() ? f.trim().slice(0, L.corto) : null),
        historia: {
            titulo: texto(g.historia?.titulo, b.historia.titulo, L.titulo),
            resaltado: optativo(g.historia?.resaltado, b.historia.resaltado, L.corto),
            capitulos: lista(g.historia?.capitulos, b.historia.capitulos, L.capitulos, c => {
                if (!c || typeof c.titulo !== 'string' || typeof c.texto !== 'string' || !c.titulo.trim() || !c.texto.trim()) return null;
                return { etiqueta: optativo(c.etiqueta, '', L.corto), titulo: c.titulo.trim().slice(0, L.titulo), texto: c.texto.trim().slice(0, L.texto), foto: fotoValida(c.foto) };
            })
        },
        frase: {
            texto: texto(g.frase?.texto, b.frase.texto, L.titulo),
            resaltado: optativo(g.frase?.resaltado, b.frase.resaltado, L.corto)
        },
        negocio: {
            titulo: texto(g.negocio?.titulo, b.negocio.titulo, L.titulo),
            resaltado: optativo(g.negocio?.resaltado, b.negocio.resaltado, L.corto),
            intro: texto(g.negocio?.intro, b.negocio.intro, L.texto),
            tipos: lista(g.negocio?.tipos, b.negocio.tipos, L.tipos, t => typeof t === 'string' && t.trim() ? t.trim().slice(0, L.corto) : null),
            pasos: b.negocio.pasos.map((paso, i) => ({
                titulo: texto(g.negocio?.pasos?.[i]?.titulo, paso.titulo, L.titulo),
                texto: texto(g.negocio?.pasos?.[i]?.texto, paso.texto, L.texto)
            }))
        },
        pie: {
            ciudad: optativo(g.pie?.ciudad, b.pie.ciudad, L.titulo)
        }
    });
}
