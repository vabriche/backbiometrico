import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';

const EXTENSIONES_PERMITIDAS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const TAMANIO_MAXIMO = 10 * 1024 * 1024; // 10MB

// Arma un manejador de Express para subir un único archivo (campo
// "documento") a `dirDestino`, nombrado con el prefijo que devuelva
// `prefijoArchivo(req)`. El middleware de multer se invoca a mano (no como
// middleware de ruta) para poder capturar sus errores (tipo de archivo no
// permitido, tamaño excedido) y responder JSON limpio en vez de dejarlos
// caer al handler por defecto de Express, que expone el stack trace.
//
// `onExito(req, res)` se llama solo si el archivo pasó las validaciones; ahí
// va la lógica específica (verificar que el recurso exista, actualizar la
// base). Si `onExito` tira una excepción, se borra el archivo recién subido
// para no dejar huérfanos en disco.
export const crearSubidorDocumento = (dirDestino, prefijoArchivo) => {
  fs.mkdirSync(dirDestino, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dirDestino),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${prefijoArchivo(req)}-${Date.now()}${ext}`);
    },
  });

  const middleware = multer({
    storage,
    limits: { fileSize: TAMANIO_MAXIMO },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!EXTENSIONES_PERMITIDAS.has(ext)) {
        return cb(new Error('Tipo de archivo no permitido. Solo PDF, JPG o PNG.'));
      }
      cb(null, true);
    },
  }).single('documento');

  return (onExito) => (req, res) => {
    middleware(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No se recibió ningún archivo (campo esperado: documento)' });
      }
      try {
        await onExito(req, res);
      } catch (error) {
        fs.unlink(req.file.path, () => {});
        console.error('Error al guardar el documento:', error);
        res.status(500).json({ error: 'Error al guardar el documento' });
      }
    });
  };
};
