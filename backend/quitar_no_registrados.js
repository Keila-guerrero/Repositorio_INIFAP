const fs = require('fs'), path = require('path'), pool = require('./db');
const UP = path.join(__dirname, 'uploads');
const DEST = path.join(require('os').homedir(), 'pdfs_sobrantes');
const APLICAR = process.argv.includes('--aplicar');
function archivos(d) {
  let r = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) r = r.concat(archivos(p)); else r.push(p);
  }
  return r;
}
(async () => {
  const [f] = await pool.query('SELECT pdf_ruta FROM publicaciones WHERE activo = 1');
  const ok = new Set(f.map((x) => path.resolve(UP, x.pdf_ruta)));
  const sobran = archivos(UP).filter((p) => !ok.has(p) && path.basename(p) !== '.gitkeep');
  sobran.forEach((p) => console.log(path.relative(UP, p)));
  console.log('Sobrantes: ' + sobran.length + '  |  Registrados que se quedan: ' + ok.size);
  if (APLICAR) {
    for (const p of sobran) {
      const d = path.join(DEST, path.relative(UP, p));
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.renameSync(p, d);
    }
    console.log('Movidos a ' + DEST);
  }
  await pool.end();
})();
