// app.js
// Lógica de interfaz, envío resiliente (patrón Outbox) y reconexión.
// Requiere que db-helper.js se cargue antes.

const ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';

const formIncidencia = document.getElementById('form-incidencia');
const inputTitulo = document.getElementById('titulo');
const inputDescripcion = document.getElementById('descripcion');
const listaOutbox = document.getElementById('lista-outbox');
const btnPurgar = document.getElementById('btn-purgar');
const badgeRed = document.getElementById('badge-red');

/* ---------- Service Worker y mensajes ---------- */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then((registro) => {
      console.log('[SW] Registrado con scope:', registro.scope);
    })
    .catch((error) => {
      console.error('[SW] Error al registrar:', error);
    });

  // Aviso del Service Worker cuando termina de sincronizar en segundo plano
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });
}

/* ---------- Indicador de red ---------- */

function actualizarIndicadorRed(){
  if (navigator.onLine) {
    badgeRed.textContent = 'En Línea';
    badgeRed.className = 'badge bg-success';
  } else {
    badgeRed.textContent = 'Sin Conexión';
    badgeRed.className = 'badge bg-danger';
  }
}

/* ---------- READ: dibujar la bandeja de salida ---------- */

function renderizarColaOutbox(){
  return obtenerTodosLosRegistros()
    .then((registros) => {
      listaOutbox.innerHTML = '';

      if (registros.length === 0) {
        const vacio = document.createElement('li');
        vacio.className = 'list-group-item text-muted text-center';
        vacio.textContent = 'No hay registros en la bandeja.';
        listaOutbox.appendChild(vacio);
        return;
      }

      // Los más recientes primero
      registros.sort((a, b) => b.fechaCreacion - a.fechaCreacion);

      registros.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center gap-2';

        const titulo = document.createElement('span');
        titulo.className = 'fw-bold me-auto';
        titulo.textContent = item.titulo;

        const estado = document.createElement('span');
        estado.className = item.estado === 'pendiente'
          ? 'badge bg-warning text-dark'
          : 'badge bg-success';
        estado.textContent = item.estado;

        const hora = document.createElement('small');
        hora.className = 'text-muted';
        hora.textContent = new Date(item.fechaCreacion).toLocaleTimeString('es-MX');

        li.appendChild(titulo);
        li.appendChild(estado);
        li.appendChild(hora);
        listaOutbox.appendChild(li);
      });
    })
    .catch((error) => {
      console.error('[Outbox] No se pudo leer la bandeja:', error);
    });
}

/* ---------- CREATE: envío resiliente ---------- */

function procesarEnvioReporte(datosFormulario){
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      // Envío exitoso: queda en la bitácora local como sincronizado
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          // Si hay Background Sync, se delega el reenvío al Service Worker
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              })
              .catch((error) => {
                console.error('[Outbox] No se pudo registrar el sync:', error);
              });
          }
        });
    })
    .then(() => {
      // Actualizar la lista en ambos escenarios
      return renderizarColaOutbox();
    });
}

/* ---------- UPDATE: reenvío desde la UI (solo sin SyncManager) ---------- */

function sincronizarPendientesFallback(){
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      // Cada pendiente se convierte en una promesa de envío + actualización
      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

/* ---------- DELETE: purgar los ya sincronizados ---------- */

function purgarSincronizados(){
  return obtenerTodosLosRegistros()
    .then((registros) => {
      const enviados = registros.filter((item) => item.estado === 'sincronizado');
      return Promise.all(enviados.map((item) => eliminarRegistro(item.id)));
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error al purgar:', error);
    });
}

/* ---------- Eventos ---------- */

formIncidencia.addEventListener('submit', (e) => {
  e.preventDefault();

  const datos = {
    titulo: inputTitulo.value.trim(),
    descripcion: inputDescripcion.value.trim()
  };

  procesarEnvioReporte(datos)
    .then(() => {
      formIncidencia.reset();
    })
    .catch((error) => {
      console.error('[Outbox] Error al procesar el envío:', error);
    });
});

btnPurgar.addEventListener('click', purgarSincronizados);

window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Solo sincronizar desde la UI si el navegador NO soporta Background Sync
  // (Safari/iOS, Firefox). En Chrome lo hace sw.js y así no se duplican los POST.
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

/* ---------- Inicio ---------- */

actualizarIndicadorRed();
renderizarColaOutbox();
