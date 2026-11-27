// portal.js - Lógica del portal público (JavaScript puro, sin librerías)
//
// Flujo: 1) Área de interés  ->  2) Formato  ->  3) Publicaciones (Ver / Descargar)
// La dirección de la página guarda en qué paso vas, por eso funciona el botón
// "Atrás" del navegador y se pueden compartir enlaces:
//     index.html                              -> elegir área
//     index.html#area=1                       -> elegir formato de esa área
//     index.html#area=1&formato=2             -> publicaciones
//     index.html#q=frijol                     -> búsqueda en todo el repositorio
//     index.html#area=1&formato=2&q=frijol    -> búsqueda dentro de esa lista

const vista = document.getElementById('vista');
const formBuscador = document.getElementById('formBuscador');
const campoBusqueda = document.getElementById('campoBusqueda');
const botonLimpiar = document.getElementById('botonLimpiar');
const modalQr = document.getElementById('modalQr');

const PUBLICACIONES_POR_PAGINA = 24;

// Catálogos que se piden una sola vez al servidor
let areas = [];
let formatosPorArea = {};   // { '0': [...todos], '1': [...con total del área 1] }

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

// Evita que un título con < > & rompa el HTML
function esc(texto) {
    return String(texto ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function pedir(ruta) {
    const respuesta = await fetch(ruta);
    if (!respuesta.ok) throw new Error('Error ' + respuesta.status);
    return respuesta.json();
}

function textoTotal(n) {
    return n === 1 ? '1 publicación' : n + ' publicaciones';
}

function leerFiltros() {
    const p = new URLSearchParams(location.hash.slice(1));
    return {
        area: parseInt(p.get('area'), 10) || null,
        formato: parseInt(p.get('formato'), 10) || null,
        q: (p.get('q') || '').trim()
    };
}

function hashDe(filtros) {
    const p = new URLSearchParams();
    if (filtros.area) p.set('area', filtros.area);
    if (filtros.formato) p.set('formato', filtros.formato);
    if (filtros.q) p.set('q', filtros.q);
    const texto = p.toString();
    return texto ? '#' + texto : '#';
}

async function obtenerFormatos(idArea) {
    const clave = idArea || 0;
    if (!formatosPorArea[clave]) {
        formatosPorArea[clave] = await pedir('/api/formatos' + (idArea ? '?area=' + idArea : ''));
    }
    return formatosPorArea[clave];
}

// ---------------------------------------------------------------------
// Íconos (Font Awesome 6.4) de cada área y de cada formato
// ---------------------------------------------------------------------
const ICONOS_AREA = {
    'Agrícola': 'fa-seedling',
    'Pecuario': 'fa-cow',
    'Forestal': 'fa-tree'
};
const ICONO_AREA_GENERICO = 'fa-leaf';
const ICONO_AREA_FA = {   // versión con prefijo, para las fichas de publicación
    'Agrícola': 'fa-solid fa-seedling',
    'Pecuario': 'fa-solid fa-cow',
    'Forestal': 'fa-solid fa-tree'
};

const ICONOS_FORMATO = {
    'Desplegables': 'fa-map',
    'Folletos': 'fa-file-lines',
    'Libro técnico': 'fa-book',
    'Publicaciones especiales': 'fa-award'
};
const ICONO_FORMATO_GENERICO = 'fa-file-lines';

function iconoArea(nombre) {
    return ICONOS_AREA[nombre] || ICONO_AREA_GENERICO;
}
function iconoFormato(nombre) {
    return ICONOS_FORMATO[nombre] || ICONO_FORMATO_GENERICO;
}

// ---------------------------------------------------------------------
// Ruta de navegación (migas de pan)
// ---------------------------------------------------------------------
function dibujarRuta(pasos) {
    // pasos: [{ texto, hash }]  (el último no lleva hash)
    const partes = pasos.map((paso) =>
        paso.hash !== undefined
            ? `<a href="${paso.hash}">${esc(paso.texto)}</a>`
            : `<strong aria-current="page">${esc(paso.texto)}</strong>`
    );
    return `<nav class="breadcrumb" aria-label="Ruta de navegación">${partes.join('<span class="sep" aria-hidden="true">/</span>')}</nav>`;
}

// ---------------------------------------------------------------------
// PASO 1: elegir área de interés
// ---------------------------------------------------------------------
function dibujarAreas() {
    const tarjetas = areas.map((area) => `
        <a class="btn-card-box ${area.total === 0 ? 'vacia' : ''}" href="#area=${area.id}">
            <span class="area-icon"><i class="fa-solid ${iconoArea(area.nombre)}" aria-hidden="true"></i></span>
            <span class="area-title">${esc(area.nombre)}</span>
            <span class="area-desc">${esc(area.descripcion)}</span>
            <span class="area-count">${textoTotal(area.total)}</span>
            <span class="action-label">Ver formatos <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span>
        </a>`).join('');

    const totalGeneral = areas.reduce((suma, area) => suma + Number(area.total || 0), 0);

    vista.innerHTML = `
        <h2 class="search-section-title titulo-seccion" tabindex="-1">Selecciona área de interés</h2>
        <div class="cards-grid">${tarjetas}</div>

        <div class="identity-grid">
            <div class="identity-card">
                <i class="fa-solid fa-bullseye" aria-hidden="true"></i>
                <h3>Misión</h3>
                <p>Poner al alcance de productores, técnicos y estudiantes las publicaciones técnicas del Campo Experimental Valle del Guadiana.</p>
            </div>
            <div class="identity-card">
                <i class="fa-solid fa-eye" aria-hidden="true"></i>
                <h3>Visión</h3>
                <p>Ser el acervo digital de referencia del conocimiento agrícola, pecuario y forestal generado para Durango.</p>
            </div>
            <div class="identity-card">
                <i class="fa-solid fa-book-open" aria-hidden="true"></i>
                <h3>Acervo</h3>
                <p class="identity-num">${totalGeneral}</p>
                <p>publicaciones disponibles para consulta y descarga.</p>
            </div>
        </div>`;
}

// ---------------------------------------------------------------------
// PASO 2: elegir formato
// ---------------------------------------------------------------------
async function dibujarFormatos(area) {
    const formatos = await obtenerFormatos(area.id);

    const tarjetas = formatos.map((formato) => `
        <a class="guinda-card ${formato.total === 0 ? 'vacia' : ''}" href="#area=${area.id}&formato=${formato.id}">
            <span class="guinda-icon"><i class="fa-solid ${iconoFormato(formato.nombre)}" aria-hidden="true"></i></span>
            <h3>${esc(formato.nombre)}</h3>
            <span class="area-desc">${esc(formato.descripcion)}</span>
            <span class="guinda-badge">${textoTotal(formato.total)}</span>
        </a>`).join('');

    vista.innerHTML = `
        ${dibujarRuta([{ texto: 'Inicio', hash: '#' }, { texto: area.nombre }])}
        <div class="cat-header">
            <div class="cat-info">
                <h2 class="titulo-seccion" tabindex="-1">${esc(area.nombre)}</h2>
                <p>${esc(area.descripcion)}</p>
            </div>
            <a class="btn-back" href="#"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Volver al inicio</a>
        </div>
        <h3 class="search-section-title">Selecciona el tipo de formato que busca</h3>
        <div class="formats-grid">${tarjetas}</div>`;
}

// ---------------------------------------------------------------------
// PASO 3: publicaciones (portada, título, Ver y Descargar)
// ---------------------------------------------------------------------
function tarjetaPublicacion(pub) {
    const anio = pub.anio ? String(pub.anio) : 'Sin año';

    const imagenPortada = pub.portada
        ? `<img src="${esc(pub.portada)}" alt="Portada de ${esc(pub.titulo)}" loading="lazy"
                onerror="this.parentNode.innerHTML = portadaVacia('${esc(pub.anio || '')}')">`
        : portadaVacia(pub.anio);

    return `
        <article class="pub-card" data-id="${pub.id}">
            <div class="pub-card-header">
                <span class="tag-gob tag-gob--verde">${esc(pub.formato)}</span>
                <span class="pub-card-year">${esc(anio)}</span>
            </div>
            <div class="pub-card-body">
                <a class="pub-card-cover" href="${esc(pub.ver)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"
                   data-contar="1">
                    ${imagenPortada}
                </a>
                <div class="pub-card-info">
                    <h3 class="pub-card-title" title="${esc(pub.titulo)}">${esc(pub.titulo)}</h3>
                    <p class="pub-card-author"><i class="${ICONO_AREA_FA[pub.area] || 'fa-solid fa-leaf'}" aria-hidden="true"></i> ${esc(pub.area)}</p>
                </div>
            </div>
            <div class="pub-card-metrics" title="Se actualiza en tiempo real">
                <span><i class="fa-regular fa-eye" aria-hidden="true"></i> <b class="cnt-consultas" data-id="${pub.id}">${pub.consultas || 0}</b> Consultas</span>
                <span><i class="fa-solid fa-download" aria-hidden="true"></i> <b class="cnt-descargas" data-id="${pub.id}">${pub.descargas || 0}</b> Descargas</span>
            </div>
            <div class="pub-card-footer">
                <div class="acciones">
                    <a class="btn-view" href="${esc(pub.ver)}" target="_blank" rel="noopener" data-contar="1"
                       aria-label="Ver ${esc(pub.titulo)}"><i class="fa-solid fa-eye" aria-hidden="true"></i> Ver</a>
                    <a class="btn-view btn-view--borde" href="${esc(pub.descargar)}" data-contar="1"
                       aria-label="Descargar ${esc(pub.titulo)}"><i class="fa-solid fa-download" aria-hidden="true"></i> Descargar</a>
                </div>
                <img class="qr-preview" src="${esc(pub.qr || '')}" alt="Código QR de ${esc(pub.titulo)}"
                     title="Ver código QR" loading="lazy" role="button" tabindex="0"
                     data-qr="${esc(pub.qr || '')}" data-titulo="${esc(pub.titulo)}">
            </div>
        </article>`;
}

// Se usa también desde el atributo onerror de la imagen
function portadaVacia(anio) {
    return `<div class="portada-vacia"><i class="fa-regular fa-file-pdf" aria-hidden="true"></i><strong>${esc(anio || 'PDF')}</strong></div>`;
}

async function dibujarResultados(filtros, area, formato) {
    vista.innerHTML = '<p class="mensaje-estado cargando"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>Cargando publicaciones...</p>';

    const parametros = new URLSearchParams();
    if (filtros.area) parametros.set('area', filtros.area);
    if (filtros.formato) parametros.set('formato', filtros.formato);
    if (filtros.q) parametros.set('q', filtros.q);
    const publicaciones = await pedir('/api/publicaciones?' + parametros.toString());

    // Migas de pan
    const pasos = [{ texto: 'Inicio', hash: '#' }];
    if (area) {
        const hashArea = hashDe({ area: area.id });
        if (formato || filtros.q) pasos.push({ texto: area.nombre, hash: hashArea });
        else pasos.push({ texto: area.nombre });
    }
    if (formato) {
        if (filtros.q) pasos.push({ texto: formato.nombre, hash: hashDe({ area: filtros.area, formato: filtros.formato }) });
        else pasos.push({ texto: formato.nombre });
    }
    if (filtros.q) pasos.push({ texto: 'Búsqueda: ' + filtros.q });

    // Título
    let titulo;
    if (formato && area) titulo = formato.nombre + ' de ' + area.nombre.toLowerCase();
    else if (area) titulo = 'Publicaciones de ' + area.nombre.toLowerCase();
    else titulo = 'Resultados de la búsqueda';

    // Texto de apoyo del banner: qué filtros están activos
    const contexto = [];
    if (area) contexto.push('Área: ' + area.nombre);
    if (formato) contexto.push('Formato: ' + formato.nombre);
    if (filtros.q) contexto.push('Búsqueda: “' + filtros.q + '”');
    const textoContexto = contexto.join('  ·  ') || 'Todo el repositorio';

    // El botón "volver" sube un nivel
    const hashVolver = formato ? hashDe({ area: filtros.area }) : (area && filtros.q ? hashDe({ area: filtros.area }) : '#');
    const textoVolver = hashVolver === '#' ? 'Volver al inicio' : 'Volver a ' + area.nombre;
    const banner = `
        <div class="cat-header cat-header--guinda">
            <div class="cat-info">
                <h2 class="titulo-seccion" tabindex="-1">${esc(titulo)}</h2>
                <p>${esc(textoContexto)}</p>
            </div>
            <a class="btn-back" href="${hashVolver}"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> ${esc(textoVolver)}</a>
        </div>`;
    let cuerpo;

    if (publicaciones.length === 0) {
        const volver = area ? hashDe({ area: area.id }) : '#';
        cuerpo = `
            <div class="mensaje-estado">
                <strong>No hay publicaciones con estos criterios</strong>
                Prueba con otra palabra clave o cambia de formato.
                <br><a class="btn-back" href="${volver}">Volver a elegir</a>
            </div>`;
        vista.innerHTML = `
            ${dibujarRuta(pasos)}
            ${banner}
            ${cuerpo}`;
        return;
    }

    vista.innerHTML = `
        ${dibujarRuta(pasos)}
        ${banner}
        <div class="results-header">
            <h3>Publicaciones</h3>
            <span class="results-count">${textoTotal(publicaciones.length)}</span>
        </div>
        <div class="catalog-grid" id="rejillaPublicaciones"></div>
        <div id="zonaMostrarMas" class="mostrar-mas-wrap"></div>`;

    const rejilla = document.getElementById('rejillaPublicaciones');
    const zonaMas = document.getElementById('zonaMostrarMas');
    let mostradas = 0;

    function mostrarMas() {
        const siguientes = publicaciones.slice(mostradas, mostradas + PUBLICACIONES_POR_PAGINA);
        rejilla.insertAdjacentHTML('beforeend', siguientes.map((p) => tarjetaPublicacion(p)).join(''));
        mostradas += siguientes.length;

        if (mostradas < publicaciones.length) {
            zonaMas.innerHTML = `<button type="button" class="btn-back mostrar-mas">
                <i class="fa-solid fa-plus" aria-hidden="true"></i> Mostrar más (${publicaciones.length - mostradas} restantes)</button>`;
            zonaMas.querySelector('button').addEventListener('click', mostrarMas);
        } else {
            zonaMas.innerHTML = '';
        }
    }
    mostrarMas();
}

// ---------------------------------------------------------------------
// Decide qué paso dibujar según la dirección (#...)
// ---------------------------------------------------------------------
async function mostrarPagina() {
    const filtros = leerFiltros();
    const area = areas.find((a) => a.id === filtros.area) || null;
    if (filtros.area && !area) filtros.area = null;

    let formato = null;
    if (filtros.formato) {
        const formatos = await obtenerFormatos(0);
        formato = formatos.find((f) => f.id === filtros.formato) || null;
        if (!formato) filtros.formato = null;
    }

    // Buscador: refleja lo que se está buscando y en qué contexto
    campoBusqueda.value = filtros.q;
    actualizarBotonLimpiar();
    if (area && formato) campoBusqueda.placeholder = 'Buscar en esta lista...';
    else if (area) campoBusqueda.placeholder = 'Buscar en ' + area.nombre + '...';
    else campoBusqueda.placeholder = 'Buscador (ingresa palabras clave...)';

    try {
        if (!filtros.q && !area) {
            dibujarAreas();
        } else if (!filtros.q && area && !formato) {
            await dibujarFormatos(area);
        } else {
            await dibujarResultados(filtros, area, formato);
        }
    } catch (error) {
        console.error(error);
        vista.innerHTML = `
            <div class="mensaje-estado">
                <strong>No se pudo cargar la información</strong>
                Revisa que el servidor esté encendido y vuelve a intentarlo.
                <br><a class="btn-back" href="#" onclick="location.reload()">Reintentar</a>
            </div>`;
        return;
    }

    // Llevar al inicio de la lista y dar foco al título (útil para lectores de pantalla)
    const titulo = vista.querySelector('.titulo-seccion');
    if (titulo) titulo.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------
// Botón "X" del buscador
// ---------------------------------------------------------------------
function actualizarBotonLimpiar() {
    botonLimpiar.classList.toggle('visible', campoBusqueda.value.length > 0);
}

campoBusqueda.addEventListener('input', actualizarBotonLimpiar);

botonLimpiar.addEventListener('click', () => {
    campoBusqueda.value = '';
    actualizarBotonLimpiar();
    const filtros = leerFiltros();
    if (filtros.q) {            // si había una búsqueda activa, se quita de la dirección
        filtros.q = '';
        location.hash = hashDe(filtros);
    }
    campoBusqueda.focus();
});

// ---------------------------------------------------------------------
// Ventana del código QR (clic en la miniatura de una publicación)
// ---------------------------------------------------------------------
function abrirQr(imagen) {
    document.getElementById('modalQrTitulo').textContent = imagen.dataset.titulo || 'Código QR';
    document.getElementById('modalQrImagen').src = imagen.dataset.qr;
    document.getElementById('modalQrDescargar').href = imagen.dataset.qr;
    modalQr.classList.add('abierto');
    document.getElementById('modalQrCerrar').focus();
}

function cerrarQr() {
    modalQr.classList.remove('abierto');
}

vista.addEventListener('click', (evento) => {
    const imagen = evento.target.closest('.qr-preview');
    if (imagen && imagen.dataset.qr) abrirQr(imagen);
});
vista.addEventListener('keydown', (evento) => {
    const imagen = evento.target.closest('.qr-preview');
    if (imagen && imagen.dataset.qr && (evento.key === 'Enter' || evento.key === ' ')) {
        evento.preventDefault();
        abrirQr(imagen);
    }
});
modalQr.addEventListener('click', (evento) => {
    if (evento.target === modalQr) cerrarQr();     // clic en el fondo oscuro
});
document.getElementById('modalQrCerrar').addEventListener('click', cerrarQr);
document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') cerrarQr();
});

// ---------------------------------------------------------------------
// Contadores en tiempo real (consultas y descargas)
// Cada pocos segundos se piden los números de las tarjetas que se ven en pantalla.
// ---------------------------------------------------------------------
const SEGUNDOS_ENTRE_ACTUALIZACIONES = 5;

function animarNumero(elemento, nuevo) {
    if (String(nuevo) === elemento.textContent) return;
    elemento.textContent = nuevo;
    elemento.classList.remove('cnt-cambio');
    void elemento.offsetWidth;            // reinicia la animación
    elemento.classList.add('cnt-cambio');
}

async function actualizarContadores() {
    const tarjetas = document.querySelectorAll('.pub-card[data-id]');
    if (tarjetas.length === 0 || document.hidden) return;
    const ids = Array.from(tarjetas).map((t) => t.dataset.id).slice(0, 200).join(',');
    try {
        const respuesta = await fetch('/api/contadores?ids=' + ids, { cache: 'no-store' });
        if (!respuesta.ok) return;
        const datos = await respuesta.json();
        Object.keys(datos).forEach((id) => {
            const c = document.querySelector('.cnt-consultas[data-id="' + id + '"]');
            const d = document.querySelector('.cnt-descargas[data-id="' + id + '"]');
            if (c) animarNumero(c, datos[id].consultas);
            if (d) animarNumero(d, datos[id].descargas);
        });
    } catch (error) {
        /* sin conexión: se vuelve a intentar en el siguiente ciclo */
    }
}

setInterval(actualizarContadores, SEGUNDOS_ENTRE_ACTUALIZACIONES * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) actualizarContadores(); });

// Tras pulsar Ver / Descargar o abrir un PDF, se refresca enseguida para ver el cambio
vista.addEventListener('click', (evento) => {
    if (evento.target.closest('[data-contar]')) {
        setTimeout(actualizarContadores, 1500);
        setTimeout(actualizarContadores, 4000);
    }
});

// El buscador respeta el área/formato en que estás
formBuscador.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const filtros = leerFiltros();
    filtros.q = campoBusqueda.value.trim();
    location.hash = hashDe(filtros);
});

window.addEventListener('hashchange', mostrarPagina);

// Inicio
(async function iniciar() {
    try {
        areas = await pedir('/api/areas');
    } catch (error) {
        console.error(error);
        vista.innerHTML = `
            <div class="mensaje-estado">
                <strong>No se pudo conectar con el servidor</strong>
                Enciende el servidor (node app.js) y recarga la página.
            </div>`;
        return;
    }
    mostrarPagina();
})();
