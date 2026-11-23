# Publicar el repositorio en Render

Render **no incluye MySQL** (solo PostgreSQL) y su disco es **temporal**. Por eso hay 3 piezas:

| Pieza | Qué usar |
|---|---|
| Servidor Node | Render → *Web Service* (Docker) |
| Base de datos MySQL | Proveedor externo gratuito: **TiDB Cloud Serverless**, **Aiven** o **Railway** |
| Los PDFs | Dentro del repositorio de GitHub (opción A) o en un Disco persistente de Render (opción B) |

## 0. Preparar todo en tu computadora (una sola vez)

1. Copia tu carpeta `FOLLETOS` completa dentro de `backend/uploads/` (ver README).
2. `node importar_pdfs.js` → registra solo los PDF reales (ignora `.crdownload`, `.zip`, `.git`, "- copia"),
   y genera las portadas en `public/portadas/`.
3. `node limpiar_repositorio.js` → reporte de PDF **faltantes, dañados o duplicados**.
   Si el reporte te parece bien: `node limpiar_repositorio.js --aplicar` (los oculta de la página)
   y, si quieres, `--aplicar --borrar-archivos` (también los borra del disco).
4. Revisa la página en http://localhost:3000.

## 1. Base de datos en la nube

1. Crea una base MySQL en el proveedor y anota host, puerto, usuario, contraseña y nombre.
2. Importa `BD/repositorio_inifap_nube.sql` (crea tablas y catálogos).
3. Pasa tus datos locales a la nube con un respaldo de la tabla de publicaciones:
   `mysqldump -u root -p --no-create-info --complete-insert repositorio_inifap publicaciones > publicaciones.sql`
   y luego impórtalo en la base de la nube. (Así los `id` coinciden con las portadas `public/portadas/<id>.jpg`.)

## 2. Subir a GitHub

* Sube también `backend/public/portadas/` (ya están ahí).
* **PDFs – opción A (la más simple):** quita la línea `backend/uploads/` de `.gitignore` y haz commit de los
  PDF. GitHub rechaza archivos de más de 100 MB y conviene que todo el repo pese menos de ~1 GB.
* **PDFs – opción B:** Render → Disks (requiere plan de pago) montado en `/app/uploads`, y copias los PDF con SSH/SCP.
  Es la que conviene si el administrador va a subir PDFs nuevos desde `admin.html`: en la opción A,
  esos archivos nuevos **se pierden** en cada despliegue/reinicio.

## 3. Crear el Web Service en Render

* New → Web Service → tu repo. **Root Directory:** `Repositorio_INIFAP V2/backend` · **Runtime:** Docker.
* **Health Check Path:** `/health`
* Variables de entorno:

| Variable | Valor |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | los de tu MySQL en la nube |
| `DB_SSL` | `true` (casi todos los MySQL en la nube lo exigen) |
| `CLAVE_ADMIN` | una clave tuya (**no dejes `inifap2026`**) |
| `BASE_URL` | la URL pública, p. ej. `https://repositorio-inifap.onrender.com` (para que los QR apunten bien) |

## 4. Verificar

* `https://TU-SITIO.onrender.com/health` → `{"ok":true}`
* Abre un PDF con **Ver** y con **Descargar**, y revisa una portada y un QR.
* En el plan gratuito el servicio se "duerme" tras unos minutos sin visitas y la primera carga tarda ~30 s.
