// admin.js - Formulario para subir publicaciones nuevas, y lista para eliminarlas
// (JavaScript puro)

const formulario = document.getElementById('formularioPublicacion');
const selectArea = document.getElementById('id_area');
const selectFormato = document.getElementById('id_formato');
const cajaError = document.getElementById('mensajeError');
const cajaResultado = document.getElementById('resultado');
const botonGuardar = document.getElementById('botonGuardar');

// --- Eliminar publicaciones ---
const buscarBorrar = document.getElementById('buscarBorrar');
const claveBorrar = document.getElementById('claveBorrar');
const listaPublicaciones = document.getElementById('listaPublicaciones');
const cajaErrorBorrar = document.getElementById('mensajeErrorBorrar');
let todasLasPublicaciones = [];

function llenarSelect(select, elementos) {
    elementos.forEach((elemento) => {
        const opcion = document.createElement('option');
        opcion.value = elemento.id;
        opcion.textContent = elemento.nombre;
        select.appendChild(opcion);
    });
}

function mostrarError(texto) {
    cajaError.textContent = texto;
    cajaError.classList.remove('oculto');
    cajaError.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 1. Cargar áreas y formatos al abrir la página
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const [areas, formatos] = await Promise.all([
            fetch('/api/areas').then((r) => r.json()),
            fetch('/api/formatos').then((r) => r.json())
        ]);
        llenarSelect(selectArea, areas);
        llenarSelect(selectFormato, formatos);
    } catch (error) {
        mostrarError('No se pudieron cargar las áreas y formatos. ¿Está encendido el servidor?');
    }

    cargarListaPublicaciones();
});

// 2. Enviar el formulario al servidor
formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    cajaError.classList.add('oculto');
    cajaResultado.classList.add('oculto');
    botonGuardar.disabled = true;
    botonGuardar.textContent = 'Guardando...';

    try {
        const respuesta = await fetch('/api/publicaciones', {
            method: 'POST',
            body: new FormData(formulario)
        });
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            mostrarError(datos.error || 'No se pudo guardar la publicación');
            return;
        }

        document.getElementById('imagenQr').src = datos.qr;
        document.getElementById('botonDescargarQr').href = datos.qr;

        const figuraPortada = document.getElementById('figuraPortada');
        if (datos.portada) {
            document.getElementById('imagenPortada').src = datos.portada + '?t=' + Date.now();
            figuraPortada.classList.remove('oculto');
        } else {
            figuraPortada.classList.add('oculto');
        }

        cajaResultado.classList.remove('oculto');
        cajaResultado.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Se limpia el formulario pero se conservan la clave, el área y el formato
        const clave = document.getElementById('clave').value;
        const area = selectArea.value;
        const formato = selectFormato.value;
        formulario.reset();
        document.getElementById('clave').value = clave;
        selectArea.value = area;
        selectFormato.value = formato;
    } catch (error) {
        console.error(error);
        mostrarError('Ocurrió un error al enviar los datos. Revisa la conexión con el servidor.');
    } finally {
        botonGuardar.disabled = false;
        botonGuardar.textContent = 'Guardar y generar QR';
    }
});

// =========================================================================
// 3. Lista de publicaciones existentes, con botón para eliminarlas
// =========================================================================

function escaparTexto(texto) {
    return String(texto ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function mostrarErrorBorrar(texto) {
    cajaErrorBorrar.textContent = texto;
    cajaErrorBorrar.classList.remove('oculto');
}

async function cargarListaPublicaciones() {
    try {
        todasLasPublicaciones = await fetch('/api/publicaciones').then((r) => r.json());
        dibujarListaPublicaciones();
    } catch (error) {
        listaPublicaciones.innerHTML = '<p class="ayuda">No se pudo cargar el listado de publicaciones.</p>';
    }
}

function dibujarListaPublicaciones() {
    const texto = buscarBorrar.value.trim().toLowerCase();
    const filtradas = texto
        ? todasLasPublicaciones.filter((p) => p.titulo.toLowerCase().includes(texto))
        : todasLasPublicaciones;

    if (filtradas.length === 0) {
        listaPublicaciones.innerHTML = '<p class="ayuda">No hay publicaciones que coincidan con la búsqueda.</p>';
        return;
    }

    listaPublicaciones.innerHTML = filtradas.slice(0, 80).map((p) => `
        <div class="fila-publicacion" data-id="${p.id}">
            <div class="fila-publicacion-texto">
                <strong>${escaparTexto(p.titulo)}</strong>
                <span class="ayuda">${escaparTexto(p.anio || 'Sin año')} · ${escaparTexto(p.area)} · ${escaparTexto(p.formato)}</span>
            </div>
            <button type="button" class="boton boton-borde boton-eliminar">Eliminar</button>
        </div>`).join('') +
        (filtradas.length > 80 ? `<p class="ayuda">Mostrando 80 de ${filtradas.length}. Escribe parte del título para acotar la búsqueda.</p>` : '');
}

buscarBorrar.addEventListener('input', dibujarListaPublicaciones);

listaPublicaciones.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('.boton-eliminar');
    if (!boton) return;

    cajaErrorBorrar.classList.add('oculto');

    const fila = boton.closest('.fila-publicacion');
    const id = fila.dataset.id;
    const titulo = fila.querySelector('strong').textContent;

    if (!claveBorrar.value) {
        mostrarErrorBorrar('Escribe la clave de administrador para poder eliminar.');
        claveBorrar.focus();
        return;
    }
    if (!confirm(`¿Eliminar definitivamente "${titulo}"?\nEsta acción no se puede deshacer.`)) {
        return;
    }

    boton.disabled = true;
    boton.textContent = 'Eliminando...';

    try {
        const respuesta = await fetch('/api/publicaciones/' + encodeURIComponent(id), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clave: claveBorrar.value })
        });
        const datos = await respuesta.json();

        if (!respuesta.ok) {
            mostrarErrorBorrar(datos.error || 'No se pudo eliminar la publicación');
            boton.disabled = false;
            boton.textContent = 'Eliminar';
            return;
        }

        todasLasPublicaciones = todasLasPublicaciones.filter((p) => String(p.id) !== String(id));
        dibujarListaPublicaciones();
    } catch (error) {
        console.error(error);
        mostrarErrorBorrar('Ocurrió un error al eliminar. Revisa la conexión con el servidor.');
        boton.disabled = false;
        boton.textContent = 'Eliminar';
    }
});
