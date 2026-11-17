// db-helper.js
// Mini-wrapper promisificado de IndexedDB.
// Se carga en index.html con <script> y en sw.js con importScripts().

const DB_NAME = 'pwa-outbox-db';
const DB_VERSION = 1;
const STORE_NAME = 'transacciones_pendientes';

// Abre la BD. Si es nueva (o sube de versión) crea el Object Store.
function abrirDB(){
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Solo se dispara si la BD no existe o la versión es mayor a la actual
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // keyPath 'id' + autoIncrement => ids numéricos automáticos (1, 2, 3...)
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

// CREATE: guarda un registro y devuelve el id generado.
// Se resuelve en tx.oncomplete, no en req.onsuccess, porque hasta ahí
// la transacción ya confirmó la escritura.
function guardarRegistro(datos){
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const req = store.add(datos);
      let idGenerado;

      req.onsuccess = (event) => {
        idGenerado = event.target.result;
      };

      tx.oncomplete = () => resolve(idGenerado);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}

// READ: devuelve un arreglo con todos los registros.
function obtenerTodosLosRegistros(){
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = (event) => resolve(event.target.result);
      req.onerror = (event) => reject(event.target.error);
    });
  });
}

// UPDATE: cambia el estado de un registro (get + put en la misma transacción).
function actualizarEstadoRegistro(id, nuevoEstado){
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // 1. Obtener el registro actual por su llave primaria
      const reqGet = store.get(id);

      reqGet.onsuccess = (event) => {
        const registro = event.target.result;
        if (!registro) {
          reject(new Error(`No se encontró el registro con ID: ${id}`));
          return;
        }

        // 2. Modificar la propiedad y sobrescribir con put()
        registro.estado = nuevoEstado;
        registro.fechaSincronizacion = Date.now();
        store.put(registro);
      };

      // 3. Resolver cuando la transacción termina de guardar
      tx.oncomplete = () => resolve(true);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}

// DELETE: elimina un registro por su llave primaria.
function eliminarRegistro(id){
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      store.delete(id);

      tx.oncomplete = () => resolve(true);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}
