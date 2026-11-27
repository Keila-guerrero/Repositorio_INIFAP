// app.js - Servidor del Repositorio de Publicaciones INIFAP
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');

const pool = require('./db');
const { generarPortada, CARPETA_PORTADAS } = require('./portadas');

const app = express();
const puerto = process.env.PORT || 3000;

// Clave sencilla para el panel de administración (cámbiala antes de publicar el sitio)
const CLAVE_ADMIN = process.env.CLAVE_ADMIN || 'inifap2026';

if (process.env.NODE_ENV === 'production' && CLAVE_ADMIN === 'inifap2026') {
    console.warn('⚠ Estás en producción con la clave de administrador por defecto. Define la variable CLAVE_ADMIN.');
}

const CARPETA_UPLOADS = path.join(__dirname, 'uploads');
const CARPETA_NUEVOS = path.join(CARPETA_UPLOADS, 'nuevos');
fs.mkdirSync(CARPETA_NUEVOS, { recursive: true });

// ---------------------------------------------------------------------
// Configuración básica
// ---------------------------------------------------------------------
app.set('trust proxy', 1); // detrás de Render/proxy, para que req.protocol sea https
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Revisión de salud (Render la usa para saber que el servidor está vivo)
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ ok: false });
    }
});

// Página web (HTML/CSS/JS), portadas y PDFs
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(CARPETA_UPLOADS));

// Multer: guarda los PDFs nuevos que se suben desde admin.html
const almacenamiento = multer.diskStorage({
    destination: (req, file, cb) => cb(null, CARPETA_NUEVOS),
    // Nombre seguro (los acentos y espacios de los nombres originales dan problemas)
    filename: (req, file, cb) => cb(null, Date.now() + '.pdf')
});
const subirPdf = multer({
    storage: almacenamiento,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
    fileFilter: (req, file, cb) => {
        cb(null, file.mimetype === 'application/pdf');
    }
});

// ---------------------------------------------------------------------
// Funciones de apoyo
// ---------------------------------------------------------------------

// '/uploads/FOLLETOS/Agrícola/mi archivo.pdf' con cada parte codificada para URL
function urlDelPdf(pdfRuta) {
    return '/uploads/' + pdfRuta.split('/').map(encodeURIComponent).join('/');
}

// Si la BD no trae la portada pero la imagen ya existe en public/portadas/<id>.jpg, se usa esa
function portadaDe(fila) {
    if (fila.portada) return fila.portada;
    return fs.existsSync(path.join(CARPETA_PORTADAS, fila.id + '.jpg')) ? '/portadas/' + fila.id + '.jpg' : null;
}

// Convierte una fila de la BD en el objeto que recibe la página
function armarPublicacion(fila) {
    return {
        id: fila.id,
        titulo: fila.titulo,
        anio: fila.anio,
        area: fila.area,
        formato: fila.formato,
        portada: portadaDe(fila),
        ver: '/ver/' + fila.id,          // abre el PDF y cuenta una consulta
        descargar: '/descargar/' + fila.id,
        qr: '/qr/' + fila.id,
        consultas: Number(fila.consultas) || 0,
        descargas: Number(fila.descargas) || 0
    };
}

// URL pública del sitio (para los QR). En Render se toma de BASE_URL o del propio host
function urlBase(req) {
    if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
    return req.protocol + '://' + req.get('host');
}

// ---- Contadores de consultas y descargas ----------------------------
// Antirrebote: la misma persona (IP) no suma dos veces el mismo PDF en 30 segundos
// (evita dobles clics y que el visor de PDF pida el archivo por partes).
const VENTANA_CONTEO_MS = 30 * 1000;
const ultimosConteos = new Map();
function debeContar(req, id, tipo) {
    if (req.method !== 'GET') return false;                       // HEAD no cuenta
    const rango = req.headers.range;
    if (rango && !/^bytes=0-/.test(rango)) return false;          // partes siguientes del mismo PDF
    const clave = req.ip + '|' + id + '|' + tipo;
    const ahora = Date.now();
    if (ahora - (ultimosConteos.get(clave) || 0) < VENTANA_CONTEO_MS) return false;
    ultimosConteos.set(clave, ahora);
    if (ultimosConteos.size > 5000) {                             // limpieza para no crecer sin fin
        for (const [k, t] of ultimosConteos) if (ahora - t > VENTANA_CONTEO_MS) ultimosConteos.delete(k);
    }
    return true;
}
async function sumarContador(columna, id) {
    const col = columna === 'descargas' ? 'descargas' : 'consultas';
    try {
        await pool.query('UPDATE publicaciones SET ' + col + ' = ' + col + ' + 1 WHERE id = ?', [id]);
    } catch (error) {
        console.error('No se pudo actualizar el contador:', error.message);  // nunca bloquea la descarga
    }
}

// Crea las columnas de contadores si la base de datos aún no las tiene
async function asegurarContadores() {
    const [cols] = await pool.query(
        `SELECT COLUMN_NAME AS nombre FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publicaciones'`);
    const nombres = cols.map((c) => c.nombre || c.COLUMN_NAME);
    if (!nombres.includes('consultas')) {
        await pool.query('ALTER TABLE publicaciones ADD COLUMN consultas INT UNSIGNED NOT NULL DEFAULT 0');
    }
    if (!nombres.includes('descargas')) {
        await pool.query('ALTER TABLE publicaciones ADD COLUMN descargas INT UNSIGNED NOT NULL DEFAULT 0');
    }
}

// Ruta absoluta del PDF de una publicación (o null si no existe / sale de uploads)
function rutaDelPdf(pdfRuta) {
    const absoluta = path.resolve(CARPETA_UPLOADS, pdfRuta);
    if (!absoluta.startsWith(CARPETA_UPLOADS + path.sep) || !fs.existsSync(absoluta)) return null;
    return absoluta;
}

// Content-Disposition que respeta acentos y ñ en cualquier navegador
// (nombre simple en ASCII + nombre completo codificado en UTF-8)
function cabeceraArchivo(tipo, nombre) {
    const ascii = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    return tipo + '; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(nombre);
}

function paginaNoEncontrada(res, mensaje) {
    res.status(404).type('html').send(
        '<!DOCTYPE html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>PDF no disponible</title><body style="font-family:Segoe UI,Arial,sans-serif;text-align:center;padding:60px 20px;color:#1f1f1f">' +
        '<h1 style="color:#611232">' + mensaje + '</h1>' +
        '<p><a href="/" style="color:#611232;font-weight:700">Volver al repositorio</a></p></body></html>');
}

// Evita que % y _ escritos por el visitante actúen como comodines de LIKE
function escaparLike(texto) {
    return texto.replace(/[\\%_]/g, '\\$&');
}

// ---------------------------------------------------------------------
// 1. Áreas de interés (con el total de publicaciones de cada una)
// ---------------------------------------------------------------------
app.get('/api/areas', async (req, res) => {
    try {
        const [filas] = await pool.query(`
            SELECT a.id, a.nombre, a.descripcion, a.imagen, COUNT(p.id) AS total
            FROM areas a
            LEFT JOIN publicaciones p ON p.id_area = a.id AND p.activo = 1
            GROUP BY a.id
            ORDER BY a.id
        `);
        res.json(filas);
    } catch (error) {
        console.error('Error al obtener áreas:', error);
        res.status(500).json({ error: 'Error al consultar la base de datos' });
    }
});

// ---------------------------------------------------------------------
// 2. Formatos (si viene ?area=ID, el total cuenta solo esa área)
// ---------------------------------------------------------------------
app.get('/api/formatos', async (req, res) => {
    try {
        const idArea = parseInt(req.query.area, 10);
        let condicionArea = '';
        const parametros = [];
        if (idArea) {
            condicionArea = 'AND p.id_area = ?';
            parametros.push(idArea);
        }
        const [filas] = await pool.query(`
            SELECT f.id, f.nombre, f.descripcion, COUNT(p.id) AS total
            FROM formatos f
            LEFT JOIN publicaciones p ON p.id_formato = f.id AND p.activo = 1 ${condicionArea}
            GROUP BY f.id
            ORDER BY f.id
        `, parametros);
        res.json(filas);
    } catch (error) {
        console.error('Error al obtener formatos:', error);
        res.status(500).json({ error: 'Error al consultar la base de datos' });
    }
});

// ---------------------------------------------------------------------
// 3. Publicaciones: /api/publicaciones?area=1&formato=2&q=frijol
//    Todos los filtros son opcionales.
// ---------------------------------------------------------------------
app.get('/api/publicaciones', async (req, res) => {
    try {
        const idArea = parseInt(req.query.area, 10);
        const idFormato = parseInt(req.query.formato, 10);
        const texto = (req.query.q || '').toString().trim().slice(0, 100);

        const condiciones = ['p.activo = 1'];
        const parametros = [];

        if (idArea) {
            condiciones.push('p.id_area = ?');
            parametros.push(idArea);
        }
        if (idFormato) {
            condiciones.push('p.id_formato = ?');
            parametros.push(idFormato);
        }
        // Cada palabra clave debe aparecer en el título (o ser el año)
        texto.split(/\s+/).filter(Boolean).forEach((palabra) => {
            condiciones.push('(p.titulo LIKE ? OR CAST(p.anio AS CHAR) = ?)');
            parametros.push('%' + escaparLike(palabra) + '%', palabra);
        });

        const [filas] = await pool.query(`
            SELECT p.id, p.titulo, p.anio, p.pdf_ruta, p.portada, p.consultas, p.descargas,
                   a.nombre AS area, f.nombre AS formato
            FROM publicaciones p
            JOIN areas a ON a.id = p.id_area
            JOIN formatos f ON f.id = p.id_formato
            WHERE ${condiciones.join(' AND ')}
            ORDER BY p.anio DESC, p.titulo ASC
        `, parametros);

        res.json(filas.map(armarPublicacion));
    } catch (error) {
        console.error('Error al obtener publicaciones:', error);
        res.status(500).json({ error: 'Error al consultar la base de datos' });
    }
});

// ---------------------------------------------------------------------
// 4. Descargar el PDF (fuerza la descarga con un nombre legible)
// ---------------------------------------------------------------------
app.get('/descargar/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10) || 0;
        const [filas] = await pool.query(
            'SELECT titulo, anio, pdf_ruta FROM publicaciones WHERE id = ? AND activo = 1',
            [id]
        );
        if (filas.length === 0) {
            return paginaNoEncontrada(res, 'Publicación no encontrada');
        }

        // Seguridad: el archivo debe estar dentro de la carpeta uploads
        const rutaAbsoluta = rutaDelPdf(filas[0].pdf_ruta);
        if (!rutaAbsoluta) {
            return paginaNoEncontrada(res, 'El archivo PDF no está en el servidor');
        }

        if (debeContar(req, id, 'descargas')) await sumarContador('descargas', id);

        const nombreLimpio = filas[0].titulo.replace(/[\\/:*?"<>|]/g, '').slice(0, 120);
        const prefijoAnio = filas[0].anio ? filas[0].anio + ' ' : '';
        res.type('application/pdf');
        res.set('Content-Disposition', cabeceraArchivo('attachment', prefijoAnio + nombreLimpio + '.pdf'));
        res.sendFile(rutaAbsoluta, { dotfiles: 'allow' });
    } catch (error) {
        console.error('Error al descargar:', error);
        res.status(500).send('Error en el servidor');
    }
});

// ---------------------------------------------------------------------
// 4a. Ver el PDF en el navegador: /ver/12
//     Es el enlace del botón "Ver" y el que llevan los códigos QR.
//     Cuenta una consulta y muestra el PDF.
// ---------------------------------------------------------------------
app.get('/ver/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10) || 0;
        const [filas] = await pool.query(
            'SELECT titulo, anio, pdf_ruta FROM publicaciones WHERE id = ? AND activo = 1', [id]);
        if (filas.length === 0) return paginaNoEncontrada(res, 'Publicación no encontrada');

        const rutaAbsoluta = rutaDelPdf(filas[0].pdf_ruta);
        if (!rutaAbsoluta) return paginaNoEncontrada(res, 'El archivo PDF no está en el servidor');

        if (debeContar(req, id, 'consultas')) await sumarContador('consultas', id);

        const nombre = ((filas[0].anio ? filas[0].anio + ' ' : '') + filas[0].titulo)
            .replace(/[\\/:*?"<>|]/g, '').slice(0, 120) + '.pdf';
        res.type('application/pdf');
        res.set('Content-Disposition', cabeceraArchivo('inline', nombre));
        res.sendFile(rutaAbsoluta, { dotfiles: 'allow' });   // admite descarga por partes (visores de PDF y celulares)
    } catch (error) {
        console.error('Error al abrir el PDF:', error);
        res.status(500).send('Error en el servidor');
    }
});

// ---------------------------------------------------------------------
// 4b. Contadores en vivo: /api/contadores?ids=1,2,3
//     La página lo consulta cada pocos segundos para actualizar las tarjetas.
// ---------------------------------------------------------------------
app.get('/api/contadores', async (req, res) => {
    try {
        const ids = (req.query.ids || '').toString().split(',')
            .map((n) => parseInt(n, 10)).filter(Boolean).slice(0, 200);
        if (ids.length === 0) return res.json({});

        const [filas] = await pool.query(
            'SELECT id, consultas, descargas FROM publicaciones WHERE id IN (?)', [ids]);
        const salida = {};
        filas.forEach((f) => { salida[f.id] = { consultas: Number(f.consultas), descargas: Number(f.descargas) }; });
        res.set('Cache-Control', 'no-store').json(salida);
    } catch (error) {
        console.error('Error al leer contadores:', error);
        res.status(500).json({ error: 'Error al consultar los contadores' });
    }
});

// ---------------------------------------------------------------------
// 4c. Código QR (PNG) de una publicación: /qr/12
//     Apunta a  <sitio>/ver/12  -> abre ese PDF (y cuenta la consulta).
//     La dirección es corta, así el QR es sencillo y se escanea bien incluso pequeño.
// ---------------------------------------------------------------------
app.get('/qr/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10) || 0;
        const [filas] = await pool.query(
            'SELECT id FROM publicaciones WHERE id = ? AND activo = 1', [id]);
        if (filas.length === 0) return res.status(404).send('Publicación no encontrada');

        const png = await qrcode.toBuffer(urlBase(req) + '/ver/' + id, {
            width: 600,
            margin: 2,
            errorCorrectionLevel: 'M',
            color: { dark: '#611232', light: '#ffffff' }
        });
        res.type('png').set('Cache-Control', 'no-cache').send(png);
    } catch (error) {
        console.error('Error al generar QR:', error);
        res.status(500).send('Error en el servidor');
    }
});

// ---------------------------------------------------------------------
// 5. Subir una publicación nueva (panel admin.html) y generar su QR
// ---------------------------------------------------------------------
app.post('/api/publicaciones', subirPdf.single('archivoPdf'), async (req, res) => {
    try {
        const { titulo, anio, id_area, id_formato, clave } = req.body;

        if (clave !== CLAVE_ADMIN) {
            if (req.file) fs.unlink(req.file.path, () => {});
            return res.status(401).json({ error: 'Clave de administrador incorrecta' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'Debes subir un archivo PDF' });
        }
        if (!titulo || !id_area || !id_formato) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: 'Faltan datos: título, área y formato son obligatorios' });
        }

        const pdfRuta = 'nuevos/' + req.file.filename;

        // A. Guardar en la base de datos
        const [resultado] = await pool.query(
            'INSERT INTO publicaciones (titulo, anio, id_area, id_formato, pdf_ruta) VALUES (?, ?, ?, ?, ?)',
            [titulo.trim(), anio || null, id_area, id_formato, pdfRuta]
        );
        const idNuevo = resultado.insertId;

        // B. Portada = primera página del PDF
        const portada = await generarPortada(req.file.path, idNuevo);
        if (portada) {
            await pool.query('UPDATE publicaciones SET portada = ? WHERE id = ?', [portada, idNuevo]);
        }

        // C. Código QR que apunta al PDF.
        //    Para que funcione desde otros celulares define BASE_URL (ej. http://192.168.1.75:3000)
        const urlPdf = urlBase(req) + '/ver/' + idNuevo;
        const qr = await qrcode.toDataURL(urlPdf, {
            width: 400,
            margin: 2,
            color: { dark: '#611232', light: '#ffffff' } // guinda institucional
        });

        res.json({ mensaje: 'Publicación guardada correctamente', id: idNuevo, portada, ver: urlPdf, qr });
    } catch (error) {
        console.error('Error al guardar publicación:', error);
        res.status(500).json({ error: 'Error en el servidor al guardar la publicación' });
    }
});

// Errores de Multer (archivo muy grande, etc.)
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({ error: 'Error al subir el archivo: ' + error.message });
    }
    next(error);
});

asegurarContadores()
    .catch((error) => console.error('No se pudieron preparar los contadores:', error.message))
    .finally(() => {
        app.listen(puerto, () => {
            console.log('Repositorio INIFAP corriendo en http://localhost:' + puerto);
            console.log('Panel de administración:     http://localhost:' + puerto + '/admin.html');
        });
    });
