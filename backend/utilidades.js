// utilidades.js - Funciones compartidas por app.js, importar_pdfs.js y mantenimiento.js
// (huella digital del PDF, validación de que el PDF abre, y preparación de la BD).

const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');

// ---------------------------------------------------------------------
// Huella SHA-256 del contenido del archivo. Dos PDFs idénticos (aunque tengan
// distinto nombre o estén en carpetas distintas) tienen la misma huella; así
// se detectan los duplicados de verdad y no solo por el nombre.
// ---------------------------------------------------------------------
function huellaDeArchivo(ruta) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        fs.createReadStream(ruta)
            .on('error', reject)
            .on('data', (trozo) => hash.update(trozo))
            .on('end', () => resolve(hash.digest('hex')));
    });
}

// ---------------------------------------------------------------------
// ¿El PDF está sano? Devuelve { ok: true } o { ok: false, motivo: '...' }
//  1. existe y no está vacío
//  2. empieza con "%PDF-"
//  3. termina con "%%EOF" (las descargas incompletas no lo tienen)
//  4. si está instalado pdfinfo (viene con poppler), debe poder leerlo
// ---------------------------------------------------------------------
function pdfinfoDisponible() {
    return new Promise((resolve) => {
        execFile('pdfinfo', ['-v'], (error) => resolve(!error || error.code !== 'ENOENT'));
    });
}
let _hayPdfinfo = null;

async function validarPdf(ruta) {
    let estado;
    try {
        estado = fs.statSync(ruta);
    } catch (e) {
        return { ok: false, motivo: 'el archivo no existe en el servidor' };
    }
    if (!estado.isFile()) return { ok: false, motivo: 'la ruta no es un archivo' };
    if (estado.size === 0) return { ok: false, motivo: 'el archivo está vacío' };

    const fd = fs.openSync(ruta, 'r');
    try {
        const inicio = Buffer.alloc(8);
        fs.readSync(fd, inicio, 0, 8, 0);
        if (!inicio.toString('latin1').startsWith('%PDF-')) {
            return { ok: false, motivo: 'no es un PDF (no empieza con %PDF-)' };
        }
        const largoFinal = Math.min(estado.size, 2048);
        const final = Buffer.alloc(largoFinal);
        fs.readSync(fd, final, 0, largoFinal, estado.size - largoFinal);
        if (!final.toString('latin1').includes('%%EOF')) {
            return { ok: false, motivo: 'el PDF está incompleto (descarga cortada o archivo truncado)' };
        }
    } finally {
        fs.closeSync(fd);
    }

    if (_hayPdfinfo === null) _hayPdfinfo = await pdfinfoDisponible();
    if (_hayPdfinfo) {
        const legible = await new Promise((resolve) => {
            execFile('pdfinfo', [ruta], { timeout: 30000 }, (error, salida, errores) => {
                // pdfinfo devuelve código 0 si pudo leer el documento
                resolve(!error);
            });
        });
        if (!legible) return { ok: false, motivo: 'el PDF está dañado (no se puede leer)' };
    }
    return { ok: true };
}

// ---------------------------------------------------------------------
// Prepara la tabla "publicaciones" para detectar duplicados. Se puede llamar
// todas las veces que se quiera: solo agrega lo que falte.
//   - columna hash_sha256 (huella del PDF)
// El índice UNIQUE de la huella lo crea mantenimiento.js después de quitar
// los duplicados que ya existan (si no, MySQL se negaría a crearlo).
// ---------------------------------------------------------------------
async function asegurarEsquema(pool) {
    const [columnas] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publicaciones'`
    );
    const nombres = columnas.map((c) => c.COLUMN_NAME);
    if (!nombres.includes('hash_sha256')) {
        await pool.query('ALTER TABLE publicaciones ADD COLUMN hash_sha256 CHAR(64) NULL AFTER pdf_ruta');
    }
}

async function existeIndiceUnicoDeHuella(pool) {
    const [indices] = await pool.query(
        `SELECT INDEX_NAME FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publicaciones'
           AND COLUMN_NAME = 'hash_sha256' AND NON_UNIQUE = 0`
    );
    return indices.length > 0;
}

async function crearIndiceUnicoDeHuella(pool) {
    if (!(await existeIndiceUnicoDeHuella(pool))) {
        await pool.query('ALTER TABLE publicaciones ADD UNIQUE KEY uq_hash_sha256 (hash_sha256)');
    }
}

// Resuelve "pdf_ruta" (relativa a uploads/) a una ruta absoluta, solo si queda
// dentro de la carpeta uploads. Devuelve null si intenta salirse de ella.
function rutaSegura(carpetaUploads, pdfRuta) {
    const absoluta = require('path').resolve(carpetaUploads, pdfRuta);
    return absoluta.startsWith(carpetaUploads + require('path').sep) ? absoluta : null;
}

// Calcula y guarda la huella de las publicaciones que todavía no la tienen.
// Devuelve cuántas se completaron. Si un archivo no existe se salta.
async function completarHuellas(pool, carpetaUploads) {
    const [pendientes] = await pool.query(
        'SELECT id, pdf_ruta FROM publicaciones WHERE hash_sha256 IS NULL AND activo = 1'
    );
    let completadas = 0;
    for (const fila of pendientes) {
        const ruta = rutaSegura(carpetaUploads, fila.pdf_ruta);
        if (!ruta || !fs.existsSync(ruta)) continue;
        try {
            const huella = await huellaDeArchivo(ruta);
            // Si otra fila ya tiene esa huella (duplicado), se deja sin huella;
            // mantenimiento.js se encarga de limpiarlo.
            const [otra] = await pool.query(
                'SELECT id FROM publicaciones WHERE hash_sha256 = ? AND id <> ?', [huella, fila.id]);
            if (otra.length === 0) {
                await pool.query('UPDATE publicaciones SET hash_sha256 = ? WHERE id = ?', [huella, fila.id]);
                completadas++;
            }
        } catch (e) { /* archivo ilegible: lo reportará mantenimiento.js */ }
    }
    return completadas;
}

// Quita acentos, mayúsculas y signos: sirve para comparar títulos
function normalizarTitulo(texto) {
    return String(texto || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = {
    huellaDeArchivo,
    validarPdf,
    asegurarEsquema,
    existeIndiceUnicoDeHuella,
    crearIndiceUnicoDeHuella,
    rutaSegura,
    completarHuellas,
    normalizarTitulo
};
