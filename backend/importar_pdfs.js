// importar_pdfs.js
// Recorre la carpeta backend/uploads/, registra cada PDF en la base de datos
// y genera su portada. Se puede ejecutar las veces que quieras: los PDFs que
// ya estaban registrados no se duplican.
//
// USO:   node importar_pdfs.js
//
// CÓMO DETECTA ÁREA Y FORMATO: por los nombres de las carpetas, igual que
// tu carpeta actual INIFAP/FOLLETOS:
//     uploads/FOLLETOS/FOLLETOS/Agricola/2022 Fitopatógenos....pdf
//             └ formato ┘        └ área ┘
// Formatos reconocidos: FOLLETOS, DESPLEGABLES, LIBRO TÉCNICO, PUBLICACIONES ESPECIALES
// Áreas reconocidas:    Agrícola, Pecuario, Forestal

const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { generarPortada, CARPETA_PORTADAS } = require('./portadas');
const { huellaDeArchivo, validarPdf, asegurarEsquema, completarHuellas, normalizarTitulo } = require('./utilidades');

const CARPETA_UPLOADS = path.join(__dirname, 'uploads');

// Quita acentos y pasa a mayúsculas para comparar nombres de carpetas
function normalizar(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

// Lista todos los .pdf dentro de una carpeta (ignora carpetas ocultas como .git o .fr-XXXX)
function buscarPdfs(carpeta) {
    let resultado = [];
    for (const elemento of fs.readdirSync(carpeta, { withFileTypes: true })) {
        // Se ignoran carpetas ocultas (.git), de mantenimiento (_duplicados) y la de admin (nuevos)
        if (elemento.name.startsWith('.') || elemento.name.startsWith('_')) continue;
        if (carpeta === CARPETA_UPLOADS && elemento.name === 'nuevos') continue;
        const ruta = path.join(carpeta, elemento.name);
        if (elemento.isDirectory()) {
            resultado = resultado.concat(buscarPdfs(ruta));
        } else if (elemento.name.toLowerCase().endsWith('.pdf')) {
            resultado.push(ruta);
        }
    }
    return resultado;
}

// Palabras que se escriben con mayúscula inicial o completa cuando un título viene TODO EN MAYÚSCULAS.
// Agrega aquí las que veas mal escritas en el sitio (en minúsculas y sin acento no importa).
const NOMBRES_PROPIOS = ['durango', 'méxico', 'mexico', 'guadiana', 'santiago', 'papasquiaro', 'dimas', 'cruces',
    'poanas', 'canatlán', 'canatlan', 'guanaceví', 'guanacevi', 'indé', 'inde', 'nayar', 'pinus', 'sierra',
    'madre', 'occidental', 'valle', 'lázaro', 'lazaro', 'cárdenas', 'cardenas', 'cevamex', 'saltillo', 'karma',
    'yoda', 'reineke', 'norte', 'centro'];
const SIGLAS = ['inifap', 'umafor', 'sicremars', 'sifor', 'dgo', 'promaf', 'cevag', 'ggavat', 'spef', 'spis',
    'iso', 'une', 'en', 'ddr', 'masagro', 'pid', 'nod', 'fm', 'sab'];
const PALABRAS_MENORES = ['de', 'del', 'la', 'las', 'el', 'los', 'en', 'y', 'e', 'o', 'u', 'a', 'al', 'con', 'por',
    'para', 'un', 'una', 'sin', 'sobre', 'bajo', 'como', 'que', 'su', 'sus'];

function mayusculaInicial(palabra) {
    return palabra.charAt(0).toUpperCase() + palabra.slice(1);
}

// Pasa "PRODUCCIÓN DE PLANTA DE PINUS EN DURANGO" a "Producción de planta de Pinus en Durango"
function pasarATipoOracion(titulo) {
    const palabras = titulo.split(' ').map((palabra, i) => {
        const minuscula = palabra.toLowerCase();
        const soloLetras = normalizar(minuscula).replace(/[^A-Z0-9]/g, '').toLowerCase();
        if (/\d/.test(palabra)) return palabra;                       // H-376, 2000, etc.
        if (SIGLAS.includes(soloLetras) && !PALABRAS_MENORES.includes(soloLetras)) return palabra.toUpperCase();
        if (NOMBRES_PROPIOS.includes(soloLetras)) return mayusculaInicial(minuscula);
        return i === 0 ? mayusculaInicial(minuscula) : minuscula;
    });
    return palabras.join(' ');
}

// "2018 PRODUCCIÓN DE HUEVO CON GALLINAS.pdf" -> { anio: 2018, titulo: "Producción de huevo con gallinas" }
function limpiarNombre(nombreArchivo) {
    let titulo = nombreArchivo.replace(/\.pdf$/i, '');

    let anio = null;
    const coincidencia = titulo.match(/^\s*((?:19|20)\d{2})\s*/);
    if (coincidencia) {
        anio = parseInt(coincidencia[1], 10);
        titulo = titulo.slice(coincidencia[0].length);
    }

    titulo = titulo
        .replace(/\s*-\s*copia\s*$/i, '')   // " - copia"
        .replace(/\s*\(\d\)\s*$/, '')        // " (2)"
        .replace(/\s+/g, ' ')
        .replace(/[.\s]+$/, '')              // puntos finales
        .trim();

    // Quita la etiqueta de serie al final: "Folleto técnico 124", "Desplegable para productores 23", etc.
    // (el formato ya se elige en el sitio, así que el título queda más limpio)
    const sinSerie = titulo.replace(
        /[\s.]+(?:folleto|desplegable|libro|publicaci[oó]n)(?:\s+(?:t[eé]cnic[oa]|cient[ií]fic(?:io|o|a)|para productores|informativ[oa]|especial))?\s*\d+\s*$/i, '');
    if (sinSerie.length >= 15) titulo = sinSerie.replace(/[.\s]+$/, '');

    // Si el título viene todo en MAYÚSCULAS lo pasamos a "Tipo oración"
    const letras = titulo.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '');
    const mayusculas = letras.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, '');
    if (letras.length > 0 && mayusculas.length / letras.length > 0.5) {
        titulo = pasarATipoOracion(titulo);
    } else {
        titulo = mayusculaInicial(titulo);
    }

    return { anio, titulo };
}

async function main() {
    // 0. La tabla debe tener la columna de huella; las filas viejas la completan
    await asegurarEsquema(pool);
    const completadas = await completarHuellas(pool, CARPETA_UPLOADS);
    if (completadas > 0) console.log('Huellas calculadas para registros anteriores: ' + completadas);

    // 1. Catálogos de la base de datos
    const [areas] = await pool.query('SELECT id, nombre FROM areas');
    const [formatos] = await pool.query('SELECT id, nombre FROM formatos');
    const idAreaPorNombre = {};
    areas.forEach((a) => { idAreaPorNombre[normalizar(a.nombre)] = a.id; });
    const idFormatoPorNombre = {};
    formatos.forEach((f) => { idFormatoPorNombre[normalizar(f.nombre)] = f.id; });

    // Lo que ya está en la BD: por ruta, por huella y por (área|formato|año|título)
    const [enBD] = await pool.query(
        'SELECT id, titulo, anio, id_area, id_formato, pdf_ruta, hash_sha256, portada, activo FROM publicaciones');
    const porRuta = new Map(enBD.map((f) => [f.pdf_ruta, f]));
    const huellasBD = new Set(enBD.filter((f) => f.hash_sha256).map((f) => f.hash_sha256));
    const clavesBD = new Set(enBD.map((f) =>
        [f.id_area, f.id_formato, f.anio, normalizarTitulo(f.titulo)].join('|')));

    // 2. Buscar PDFs. Los que dicen "copia" quedan al final para preferir el original.
    const archivos = buscarPdfs(CARPETA_UPLOADS).sort((a, b) => {
        const copiaA = /copia/i.test(a) ? 1 : 0;
        const copiaB = /copia/i.test(b) ? 1 : 0;
        return copiaA - copiaB || a.length - b.length || a.localeCompare(b);
    });
    console.log('PDFs encontrados en uploads/: ' + archivos.length);

    const sinClasificar = [];
    const repetidos = [];      // mismo contenido (huella) o mismo título/año/área/formato
    const danados = [];        // no abren o están incompletos
    let nuevos = 0;
    let yaRegistrados = 0;
    let portadasNuevas = 0;
    let sinPortada = 0;
    const clavesCorrida = new Set();

    for (let i = 0; i < archivos.length; i++) {
        const rutaAbsoluta = archivos[i];
        const relativa = path.relative(CARPETA_UPLOADS, rutaAbsoluta).split(path.sep);
        const pdfRuta = relativa.join('/');
        const nombreArchivo = relativa[relativa.length - 1];
        const carpetas = relativa.slice(0, -1).map(normalizar);

        // Se toma la carpeta más cercana al archivo que coincida
        let idArea = null;
        let idFormato = null;
        for (let k = carpetas.length - 1; k >= 0; k--) {
            if (idArea === null && idAreaPorNombre[carpetas[k]]) idArea = idAreaPorNombre[carpetas[k]];
            if (idFormato === null && idFormatoPorNombre[carpetas[k]]) idFormato = idFormatoPorNombre[carpetas[k]];
        }
        if (!idArea || !idFormato) {
            sinClasificar.push(pdfRuta);
            continue;
        }

        // Ya registrado con esta misma ruta: solo se revisa la portada
        const existente = porRuta.get(pdfRuta);
        if (existente) {
            yaRegistrados++;
            if (!existente.activo) continue;   // oculta por mantenimiento (PDF dañado o faltante)
            const existeJpg = existente.portada && fs.existsSync(path.join(CARPETA_PORTADAS, existente.id + '.jpg'));
            if (!existeJpg) {
                const portada = await generarPortada(rutaAbsoluta, existente.id);
                if (portada) {
                    await pool.query('UPDATE publicaciones SET portada = ? WHERE id = ?', [portada, existente.id]);
                    portadasNuevas++;
                } else sinPortada++;
            }
            continue;
        }

        // El PDF debe abrir correctamente
        const estado = await validarPdf(rutaAbsoluta);
        if (!estado.ok) {
            danados.push(pdfRuta + '  → ' + estado.motivo);
            continue;
        }

        // Duplicado por contenido (aunque tenga otro nombre o esté en otra carpeta)
        const huella = await huellaDeArchivo(rutaAbsoluta);
        if (huellasBD.has(huella)) {
            repetidos.push(pdfRuta + '  → mismo contenido que otro PDF ya registrado');
            continue;
        }

        // Duplicado por título + año + área + formato (p. ej. "- copia" con otro contenido)
        const { anio, titulo } = limpiarNombre(nombreArchivo);
        const clave = [idArea, idFormato, anio, normalizarTitulo(titulo)].join('|');
        if (clavesBD.has(clave) || clavesCorrida.has(clave)) {
            repetidos.push(pdfRuta + '  → mismo título, año, área y formato que otro registro');
            continue;
        }
        clavesCorrida.add(clave);
        huellasBD.add(huella);

        const [resultado] = await pool.query(
            'INSERT INTO publicaciones (titulo, anio, id_area, id_formato, pdf_ruta, hash_sha256) VALUES (?, ?, ?, ?, ?, ?)',
            [titulo, anio, idArea, idFormato, pdfRuta, huella]
        );
        nuevos++;

        const portada = await generarPortada(rutaAbsoluta, resultado.insertId);
        if (portada) {
            await pool.query('UPDATE publicaciones SET portada = ? WHERE id = ?', [portada, resultado.insertId]);
            portadasNuevas++;
        } else sinPortada++;

        if ((i + 1) % 25 === 0 || i + 1 === archivos.length) {
            console.log('  revisados ' + (i + 1) + ' de ' + archivos.length + '...');
        }
    }

    // 5. Resumen
    console.log('\n===== RESUMEN =====');
    console.log('Publicaciones nuevas registradas: ' + nuevos);
    console.log('Ya estaban registradas:           ' + yaRegistrados);
    console.log('Portadas generadas:               ' + portadasNuevas);
    if (sinPortada > 0) {
        console.log('Sin portada:                      ' + sinPortada + '  (¿está instalado pdftoppm / poppler?)');
    }
    console.log('Duplicados omitidos:              ' + repetidos.length);
    repetidos.forEach((r) => console.log('  - ' + r));
    if (danados.length > 0) {
        console.log('\nPDFs dañados u incompletos, NO registrados (' + danados.length + '):');
        danados.forEach((r) => console.log('  - ' + r));
    }
    if (sinClasificar.length > 0) {
        console.log('\nOmitidos por no tener carpeta de ÁREA y FORMATO (' + sinClasificar.length + '):');
        sinClasificar.forEach((r) => console.log('  - ' + r));
    }

    await pool.end();
}

main().catch((error) => {
    console.error('Error al importar:', error.message);
    process.exit(1);
});
