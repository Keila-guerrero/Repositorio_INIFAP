// limpiar_repositorio.js
// -----------------------------------------------------------------------
// Revisa que cada publicación de la base de datos tenga su PDF y que el PDF
// esté sano, y oculta (activo = 0) lo que no sirve para que NO aparezca en
// la página. No borra nada de la base de datos.
//
//   Detecta:
//     - PDF que no existe en backend/uploads/        -> "falta"
//     - PDF vacío o truncado (descarga incompleta)    -> "dañado"
//     - PDF repetido (mismo contenido, p. ej. "- copia") -> "duplicado"
//       (se conserva el original: sin "copia" y con la ruta más corta)
//
// USO:
//   node limpiar_repositorio.js                      -> solo muestra el reporte (no cambia nada)
//   node limpiar_repositorio.js --aplicar            -> oculta en la BD lo dañado/faltante/duplicado
//   node limpiar_repositorio.js --aplicar --borrar-archivos
//                                                    -> además borra del disco los PDF dañados y duplicados
// -----------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('./db');

const CARPETA_UPLOADS = path.join(__dirname, 'uploads');
const APLICAR = process.argv.includes('--aplicar');
const BORRAR = process.argv.includes('--borrar-archivos');

// Un PDF sano empieza con "%PDF-" y termina con "%%EOF" (dentro de los últimos 2 KB)
function revisarPdf(ruta) {
    let stat;
    try { stat = fs.statSync(ruta); } catch (e) { return 'falta'; }
    if (!stat.isFile()) return 'falta';
    if (stat.size < 1024) return 'dañado';
    const fd = fs.openSync(ruta, 'r');
    try {
        const cabeza = Buffer.alloc(5);
        fs.readSync(fd, cabeza, 0, 5, 0);
        const tamCola = Math.min(2048, stat.size);
        const cola = Buffer.alloc(tamCola);
        fs.readSync(fd, cola, 0, tamCola, stat.size - tamCola);
        if (cabeza.toString('latin1') !== '%PDF-') return 'dañado';
        if (!cola.toString('latin1').includes('%%EOF')) return 'dañado';
    } finally {
        fs.closeSync(fd);
    }
    return 'ok';
}

function huella(ruta) {
    return crypto.createHash('sha1').update(fs.readFileSync(ruta)).digest('hex');
}

async function main() {
    const [filas] = await pool.query('SELECT id, titulo, anio, pdf_ruta FROM publicaciones WHERE activo = 1 ORDER BY id');
    console.log('Publicaciones activas en la BD: ' + filas.length + (APLICAR ? '' : '   (modo reporte: no se cambia nada)'));

    const problemas = { falta: [], dañado: [], duplicado: [] };
    const sanas = [];

    for (const f of filas) {
        const absoluta = path.resolve(CARPETA_UPLOADS, f.pdf_ruta);
        // Seguridad: debe estar dentro de uploads
        const estado = absoluta.startsWith(CARPETA_UPLOADS + path.sep) ? revisarPdf(absoluta) : 'falta';
        if (estado === 'ok') sanas.push({ ...f, absoluta });
        else problemas[estado].push({ ...f, absoluta });
    }

    // Duplicados: mismo contenido exacto. Se conserva el original.
    const grupos = new Map();
    for (const s of sanas) {
        const h = huella(s.absoluta);
        if (!grupos.has(h)) grupos.set(h, []);
        grupos.get(h).push(s);
    }
    for (const grupo of grupos.values()) {
        if (grupo.length < 2) continue;
        grupo.sort((a, b) =>
            (/copia/i.test(a.pdf_ruta) ? 1 : 0) - (/copia/i.test(b.pdf_ruta) ? 1 : 0) ||
            a.pdf_ruta.length - b.pdf_ruta.length || a.id - b.id);
        problemas.duplicado.push(...grupo.slice(1));
    }

    for (const tipo of ['falta', 'dañado', 'duplicado']) {
        console.log('\n' + tipo.toUpperCase() + ' (' + problemas[tipo].length + ')');
        problemas[tipo].forEach((p) => console.log('  #' + p.id + '  ' + p.pdf_ruta));
    }

    const total = problemas.falta.length + problemas.dañado.length + problemas.duplicado.length;
    console.log('\nPublicaciones sanas y únicas: ' + (filas.length - total));

    if (APLICAR && total > 0) {
        const ids = [...problemas.falta, ...problemas.dañado, ...problemas.duplicado].map((p) => p.id);
        for (const id of ids) await pool.query('UPDATE publicaciones SET activo = 0 WHERE id = ?', [id]);
        console.log('Ocultas en la página: ' + ids.length + '  (siguen en la BD con activo = 0)');
        if (BORRAR) {
            let borrados = 0;
            for (const p of [...problemas.dañado, ...problemas.duplicado]) {
                try { fs.unlinkSync(p.absoluta); borrados++; } catch (e) { /* ya no estaba */ }
            }
            console.log('Archivos borrados del disco: ' + borrados);
        }
    } else if (!APLICAR && total > 0) {
        console.log('Para ocultarlos de la página ejecuta:  node limpiar_repositorio.js --aplicar');
    }

    await pool.end();
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
