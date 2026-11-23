// mantenimiento.js
// Revisa la base de datos contra los PDFs reales y deja todo limpio:
//   1. Quita publicaciones DUPLICADAS (mismo PDF registrado dos o más veces).
//   2. Oculta las publicaciones cuyo PDF falta o está dañado (no abre).
//   3. Calcula la huella de cada PDF y protege la BD para que no vuelvan a duplicarse.
//
// USO:
//   node mantenimiento.js            → solo MUESTRA el reporte, no cambia nada
//   node mantenimiento.js --aplicar  → aplica los cambios (antes guarda un respaldo en backend/respaldos/)
//
// Los PDFs duplicados no se borran: se mueven a uploads/_duplicados/ por si acaso.

const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { CARPETA_PORTADAS } = require('./portadas');
const {
    huellaDeArchivo, validarPdf, asegurarEsquema, crearIndiceUnicoDeHuella,
    rutaSegura, normalizarTitulo
} = require('./utilidades');

const CARPETA_UPLOADS = path.join(__dirname, 'uploads');
const CARPETA_DUPLICADOS = path.join(CARPETA_UPLOADS, '_duplicados');
const CARPETA_RESPALDOS = path.join(__dirname, 'respaldos');
const APLICAR = process.argv.includes('--aplicar');

function etiqueta(f) {
    return '#' + f.id + ' ' + (f.anio || 's/año') + ' ' + f.titulo.slice(0, 70) + '  [' + f.pdf_ruta + ']';
}

// Puntaje para decidir cuál registro se conserva dentro de un grupo de duplicados
function puntaje(f) {
    let p = 0;
    if (!/copia|\(\d\)/i.test(f.pdf_ruta)) p += 4;     // preferir el que no se llama "copia"
    if (f.portada) p += 2;
    if (f.activo) p += 1;
    return p;
}
function mejorPrimero(a, b) {
    return puntaje(b) - puntaje(a) || b.tamano - a.tamano || a.pdf_ruta.length - b.pdf_ruta.length || a.id - b.id;
}

async function main() {
    await asegurarEsquema(pool);
    const [filas] = await pool.query(
        'SELECT id, titulo, anio, id_area, id_formato, pdf_ruta, hash_sha256, portada, activo FROM publicaciones ORDER BY id');
    console.log('Publicaciones en la base de datos: ' + filas.length);

    // 1. Revisar el archivo de cada registro
    const sanas = [];
    const danadas = [];   // { fila, motivo }
    for (let i = 0; i < filas.length; i++) {
        const f = filas[i];
        const ruta = rutaSegura(CARPETA_UPLOADS, f.pdf_ruta);
        if (!ruta) { danadas.push({ fila: f, motivo: 'ruta fuera de uploads/' }); continue; }
        const estado = await validarPdf(ruta);
        if (!estado.ok) { danadas.push({ fila: f, motivo: estado.motivo }); continue; }
        f.ruta = ruta;
        f.tamano = fs.statSync(ruta).size;
        f.huella = await huellaDeArchivo(ruta);
        sanas.push(f);
        if ((i + 1) % 100 === 0) console.log('  revisadas ' + (i + 1) + ' de ' + filas.length + '...');
    }

    // 2. Duplicados exactos (misma huella)
    const porHuella = new Map();
    sanas.forEach((f) => {
        if (!porHuella.has(f.huella)) porHuella.set(f.huella, []);
        porHuella.get(f.huella).push(f);
    });
    const sobrantes = [];     // { fila, motivo, conservar }
    const conservadasPorHuella = [];
    for (const grupo of porHuella.values()) {
        grupo.sort(mejorPrimero);
        conservadasPorHuella.push(grupo[0]);
        grupo.slice(1).forEach((f) => sobrantes.push({ fila: f, conservar: grupo[0], motivo: 'mismo PDF (contenido idéntico)' }));
    }

    // 3. Duplicados probables (mismo área + formato + año + título, contenido distinto)
    const porClave = new Map();
    conservadasPorHuella.forEach((f) => {
        const clave = [f.id_area, f.id_formato, f.anio, normalizarTitulo(f.titulo)].join('|');
        if (!porClave.has(clave)) porClave.set(clave, []);
        porClave.get(clave).push(f);
    });
    const conservadas = [];
    for (const grupo of porClave.values()) {
        grupo.sort(mejorPrimero);
        conservadas.push(grupo[0]);
        grupo.slice(1).forEach((f) => sobrantes.push({ fila: f, conservar: grupo[0], motivo: 'mismo título, año, área y formato' }));
    }

    // 4. Reporte
    const aOcultar = danadas.filter((d) => d.fila.activo);
    const aReactivar = conservadas.filter((f) => !f.activo);
    console.log('\n===== REPORTE =====');
    console.log('Publicaciones correctas y únicas:       ' + conservadas.length);
    console.log('Duplicados a eliminar:                  ' + sobrantes.length);
    console.log('PDFs faltantes o dañados (se ocultan):  ' + danadas.length);
    if (aReactivar.length) console.log('Ocultas que ya están sanas (se reactivan): ' + aReactivar.length);

    if (sobrantes.length) {
        console.log('\nDuplicados (se elimina el primero, se conserva el segundo):');
        sobrantes.forEach((s) => {
            console.log('  ✗ ' + etiqueta(s.fila) + '\n    ✓ ' + etiqueta(s.conservar) + '   (' + s.motivo + ')');
        });
    }
    if (danadas.length) {
        console.log('\nPDFs que no abren o no existen:');
        danadas.forEach((d) => console.log('  - ' + etiqueta(d.fila) + '  → ' + d.motivo));
    }

    if (!APLICAR) {
        console.log('\nNo se cambió nada. Para aplicar la limpieza ejecuta:  node mantenimiento.js --aplicar');
        await pool.end();
        return;
    }

    // 5. Respaldo antes de tocar la base de datos
    fs.mkdirSync(CARPETA_RESPALDOS, { recursive: true });
    const sello = new Date().toISOString().replace(/[:.]/g, '-');
    const archivoRespaldo = path.join(CARPETA_RESPALDOS, 'publicaciones_' + sello + '.json');
    fs.writeFileSync(archivoRespaldo, JSON.stringify(filas, null, 2));
    console.log('\nRespaldo guardado en: ' + archivoRespaldo);

    // 6. Aplicar
    fs.mkdirSync(CARPETA_DUPLICADOS, { recursive: true });
    for (const s of sobrantes) {
        const f = s.fila;
        await pool.query('DELETE FROM publicaciones WHERE id = ?', [f.id]);
        const destino = path.join(CARPETA_DUPLICADOS, f.pdf_ruta.replace(/[\\/]/g, '__'));
        try { fs.renameSync(f.ruta, destino); } catch (e) { /* ya no estaba */ }
        const jpg = path.join(CARPETA_PORTADAS, f.id + '.jpg');
        if (fs.existsSync(jpg)) fs.unlinkSync(jpg);
    }

    for (const d of danadas) {
        await pool.query('UPDATE publicaciones SET activo = 0, hash_sha256 = NULL WHERE id = ?', [d.fila.id]);
    }
    for (const f of conservadas) {
        await pool.query('UPDATE publicaciones SET hash_sha256 = ?, activo = 1 WHERE id = ?', [f.huella, f.id]);
    }

    await crearIndiceUnicoDeHuella(pool);

    const [[total]] = await pool.query('SELECT COUNT(*) AS n FROM publicaciones WHERE activo = 1');
    console.log('\nListo. Publicaciones visibles ahora: ' + total.n);
    console.log('Duplicados eliminados: ' + sobrantes.length + '  (sus PDFs están en uploads/_duplicados/)');
    console.log('Ocultas por PDF faltante/dañado: ' + danadas.length);
    console.log('La base de datos ya rechaza PDFs repetidos.');
    console.log('Siguiente paso:  node importar_pdfs.js  (registra los PDFs nuevos que falten)');

    await pool.end();
}

main().catch((error) => {
    console.error('Error en el mantenimiento:', error.message);
    process.exit(1);
});
