// El build ESM de xlsx (xlsx.mjs) falla al leer rutas relativas con
// `readFile`; se fuerza el build CommonJS (xlsx.js), que funciona bien.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const xlsx = require('xlsx');

import multer from 'multer';
import { connect } from '../database.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crearSubidorDocumento } from '../utils/subirDocumento.js';

const RAIZ_PROYECTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// El Excel de partes médicos se sube desde la PC del usuario (botón
// "Actualizar Partes Sanidad"). Se acepta cualquier nombre de archivo; solo
// se valida la extensión. Se procesa en memoria, no se guarda en disco.
const EXTENSIONES_EXCEL_PERMITIDAS = new Set(['.xls', '.xlsx']);
const TAMANIO_MAXIMO_EXCEL = 15 * 1024 * 1024; // 15MB

const uploadExcelMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANIO_MAXIMO_EXCEL },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!EXTENSIONES_EXCEL_PERMITIDAS.has(ext)) {
      return cb(new Error('Tipo de archivo no permitido. Debe ser .xls o .xlsx.'));
    }
    cb(null, true);
  },
}).single('archivo');

// Middleware de ruta: valida el archivo subido y responde JSON limpio si
// falla (en vez de dejar caer el error de multer al handler por defecto de
// Express, que expone el stack trace).
export const uploadExcelPartesMedicos = (req, res, next) => {
  uploadExcelMiddleware(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo (campo esperado: archivo)' });
    }
    next();
  });
};

// Documentos asociados a los partes médicos (certificados escaneados, etc.)
const DIR_DOCUMENTOS = path.resolve(RAIZ_PROYECTO, 'uploads', 'partes_medicos');
const subirDocumento = crearSubidorDocumento(DIR_DOCUMENTOS, (req) => req.params.codParte);

// Convierte "15/09/2026" -> "2026-09-15"
const parseFecha = (fechaStr) => {
  if (!fechaStr) return null;
  const partes = String(fechaStr).split('/');
  if (partes.length !== 3) return null;
  const [d, m, y] = partes;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
};

// El exportable de partes médicos usa textos de motivo que no coinciden
// literalmente con `motina.Motivo` (revisado y confirmado a mano). Se
// normalizan acá antes de buscar en el mapa cargado de la base.
const ALIAS_MOTIVOS = {
  'cuidado de familiar enfermo': 'familiar enfermo',
  'enfermedad corto tratamiento': 'enfermedad',
  'enfermedad largo tratamiento': 'enfermedad prolongada',
  'post-maternidad': 'postmaternidad',
};

const normalizarMotivo = (motivoTexto) => {
  const clave = String(motivoTexto || '').trim().toLowerCase();
  return ALIAS_MOTIVOS[clave] || clave;
};

const cargarMapaMotivos = async (db) => {
  const [rows] = await db.query('SELECT codina, Motivo FROM motina');
  const map = new Map();
  for (const r of rows) {
    map.set(String(r.Motivo).trim().toLowerCase(), r.codina);
  }
  return map;
};

const existeAgente = async (db, legajo) => {
  const [rows] = await db.query('SELECT legajo FROM agentes WHERE legajo = ?', [legajo]);
  return rows.length > 0;
};

// Sin acentos/mayúsculas/espacios de más, para comparar encabezados sin que
// una tilde o un espacio corrido tire abajo la validación.
const normalizarTexto = (texto) => String(texto ?? '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

// Fila de nombres de columna (3ra fila) del exportable de Sanidad. El orden
// importa: es el mismo que usa la desestructuración de abajo para leer cada fila.
const ENCABEZADOS_ESPERADOS = [
  'legajo', 'apellido y nombre', 'edad', 'instituto', 'agrup.',
  'fecha inicio', 'fecha fin', 'dias', 'motivo', 'decreto',
  'articulo e inciso', 'cod. parte', 'estado',
];

// Valida que el archivo tenga las 3 filas de encabezado esperadas (título /
// categoría / nombre de columna) y que la fila de nombres de columna
// coincida con las que este importador sabe leer. Devuelve un mensaje de
// error para mostrarle al usuario, o null si el archivo está OK.
const validarEncabezados = (filasCrudas) => {
  if (!filasCrudas || filasCrudas.length < 3) {
    return 'El archivo no tiene el formato esperado: le faltan las filas de encabezado.';
  }
  const encabezados = (filasCrudas[2] || []).map(normalizarTexto);
  const faltantes = ENCABEZADOS_ESPERADOS.filter((esperado, i) => encabezados[i] !== esperado);
  if (faltantes.length > 0) {
    return `El archivo no tiene las columnas esperadas. Revisar: ${faltantes.join(', ')}.`;
  }
  return null;
};

// Todos los partes médicos, sin filtrar por estado ni por registrado — el
// filtrado se hace en el frontend (por estado, por registrado, por motivo)
// para no ocultar registros por un criterio fijo del backend.
export const getPartesMedicosTodos = async (req, res) => {
  const strqry = `
    SELECT pm.id, pm.cod_parte, pm.legajo, pm.apellido_nombre,
           DATE_FORMAT(pm.fecha_inicio,"%d-%m-%Y") as fechaInicio,
           DATE_FORMAT(pm.fecha_fin,"%d-%m-%Y") as fechaFin,
           pm.dias, pm.motivo_cod, mo.Motivo as motivoDesc,
           pm.decreto, pm.articulo_inciso, pm.estado, pm.estado_anterior, pm.registrado,
           pm.id_ina_generada
    FROM partes_medicos pm
    LEFT JOIN motina mo ON mo.codina = pm.motivo_cod
    ORDER BY pm.fecha_inicio DESC
  `;
  try {
    const db = await connect();
    const [rows] = await db.query(strqry);
    res.send(rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: 'Error al consultar los partes médicos' });
  }
};

// Importa el Excel de partes médicos subido desde la PC (ver
// uploadExcelPartesMedicos) a la tabla partes_medicos: inserta los partes
// nuevos y, para los que ya existen, solo actualiza el estado cuando pasa de
// 'A' (activo) a 'C' (cerrado).
export const importarPartesMedicos = async (req, res) => {
  let db;
  try {
    let wb;
    try {
      wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    } catch (error) {
      return res.status(400).json({ error: 'El archivo no es una planilla válida. Tiene que ser un Excel (.xls o .xlsx).' });
    }

    const hoja = wb.Sheets[wb.SheetNames[0]];
    if (!hoja) {
      return res.status(400).json({ error: 'El archivo no tiene ninguna hoja con datos.' });
    }
    const filasCrudas = xlsx.utils.sheet_to_json(hoja, { header: 1, raw: false });

    const errorEncabezados = validarEncabezados(filasCrudas);
    if (errorEncabezados) {
      return res.status(400).json({ error: errorEncabezados });
    }

    // Las primeras 3 filas son encabezados (título / categoría / nombre de columna)
    const filas = filasCrudas.slice(3).filter(f => f && f[0]);
    if (filas.length === 0) {
      return res.status(400).json({ error: 'El archivo no tiene filas de datos para importar.' });
    }

    db = await connect();
    const mapaMotivos = await cargarMapaMotivos(db);

    let insertados = 0, actualizados = 0, sinCambios = 0;
    const legajosSinAgente = [];
    const motivosSinMapear = [];
    const cerrados = []; // partes que pasaron de Activo a Cerrado en esta importación

    for (const fila of filas) {
      const [
        legajoRaw, apellidoNombre, , , ,
        fechaInicioRaw, fechaFinRaw, diasRaw,
        motivoTexto, decreto, articuloInciso, codParteRaw, estado
      ] = fila;

      const legajo = parseInt(legajoRaw, 10);
      const codParte = parseInt(codParteRaw, 10);
      if (!legajo || !codParte) continue;

      const motivoCod = mapaMotivos.get(normalizarMotivo(motivoTexto)) || null;
      if (!motivoCod) {
        motivosSinMapear.push({ codParte, motivoTexto });
      }

      if (!(await existeAgente(db, legajo))) {
        legajosSinAgente.push({ codParte, legajo });
        continue;
      }

      const [existentes] = await db.query(
        'SELECT estado, fecha_inicio, fecha_fin, dias FROM partes_medicos WHERE cod_parte = ?',
        [codParte]
      );

      // Se guardan tal cual vienen del Excel. OJO: mientras el parte está
      // abierto las fechas vienen "al revés" (la columna Fecha Fin trae el
      // inicio real y Fecha Inicio una fecha posterior/provisoria); recién al
      // cerrarse vienen en orden. Esa corrección se hace al gestionar el parte.
      const fechaInicio = parseFecha(fechaInicioRaw);
      const fechaFin = parseFecha(fechaFinRaw);
      const dias = diasRaw !== undefined && diasRaw !== '' ? parseInt(diasRaw, 10) : null;

      if (existentes.length === 0) {
        await db.query(
          `INSERT INTO partes_medicos
            (cod_parte, legajo, apellido_nombre, fecha_inicio, fecha_fin, dias,
             motivo_cod, decreto, articulo_inciso, estado, estado_anterior, fecha_cambio_estado)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
          [codParte, legajo, apellidoNombre, fechaInicio, fechaFin, dias,
            motivoCod, decreto, articuloInciso, estado]
        );
        insertados++;
      } else {
        const estadoActual = existentes[0].estado;
        if (estadoActual === 'A' && estado === 'C') {
          // Al cerrarse el parte, Sanidad puede haber corregido el rango de
          // fechas (y por lo tanto los días) respecto de lo que se había
          // cargado con el parte todavía abierto — se actualizan también acá.
          await db.query(
            `UPDATE partes_medicos
               SET estado = ?, estado_anterior = ?, fecha_cambio_estado = NOW(),
                   fecha_inicio = ?, fecha_fin = ?, dias = ?
             WHERE cod_parte = ?`,
            [estado, estadoActual, fechaInicio, fechaFin, dias, codParte]
          );
          actualizados++;
          cerrados.push({ codParte, legajo });
        } else {
          sinCambios++;
        }
      }
    }

    res.status(200).json({
      insertados,
      actualizados,
      sinCambios,
      sinAgente: legajosSinAgente.length,
      sinMotivo: motivosSinMapear.length,
      detalleSinAgente: legajosSinAgente,
      detalleSinMotivo: motivosSinMapear,
      detalleCerrados: cerrados,
    });
  } catch (error) {
    console.error('Error al importar partes médicos:', error);
    res.status(500).json({ error: 'Error al importar partes médicos', detalle: error.message });
  }
};

// Partes médicos de un legajo puntual
export const getPartesMedicosPorLegajo = async (req, res) => {
  const { legajo } = req.params;
  const strqry = `
    SELECT pm.id, pm.cod_parte, pm.legajo, pm.apellido_nombre,
           DATE_FORMAT(pm.fecha_inicio,"%d-%m-%Y") as fechaInicio,
           DATE_FORMAT(pm.fecha_fin,"%d-%m-%Y") as fechaFin,
           pm.dias, pm.motivo_cod, mo.Motivo as motivoDesc,
           pm.decreto, pm.articulo_inciso, pm.estado, pm.estado_anterior, pm.registrado,
           pm.id_ina_generada, pm.ruta_documento
    FROM partes_medicos pm
    LEFT JOIN motina mo ON mo.codina = pm.motivo_cod
    WHERE pm.legajo = ?
    ORDER BY pm.fecha_inicio DESC
  `;
  try {
    const db = await connect();
    const [rows] = await db.query(strqry, [legajo]);
    res.send(rows);
  } catch (error) {
    console.error('Error al obtener partes médicos del legajo:', error);
    res.status(500).json({ error: 'Error al obtener partes médicos' });
  }
};

// Marca un parte médico como anulado ('A') o ya registrado en inasistencia
// ('S', con el id_ina generado). Solo se permite la transición desde
// pendiente ('N'), para no pisar un registro ya procesado por error.
export const actualizarRegistroParte = async (req, res) => {
  const { codParte } = req.params;
  const { registrado, id_ina_generada } = req.body;

  if (!['S', 'A'].includes(registrado)) {
    return res.status(400).json({ error: "registrado debe ser 'S' (registrado) o 'A' (anulado)" });
  }
  if (registrado === 'S' && !id_ina_generada) {
    return res.status(400).json({ error: 'id_ina_generada es requerido cuando registrado = S' });
  }

  try {
    const db = await connect();

    const [partes] = await db.query('SELECT registrado FROM partes_medicos WHERE cod_parte = ?', [codParte]);
    if (partes.length === 0) {
      return res.status(404).json({ error: 'Parte médico no encontrado' });
    }
    if (partes[0].registrado !== 'N') {
      return res.status(409).json({ error: `El parte ya fue procesado (registrado='${partes[0].registrado}')` });
    }

    if (registrado === 'S') {
      const [inasistencias] = await db.query('SELECT id_ina FROM inasist WHERE id_ina = ?', [id_ina_generada]);
      if (inasistencias.length === 0) {
        return res.status(400).json({ error: 'id_ina_generada no corresponde a ninguna inasistencia existente' });
      }
    }

    await db.query(
      `UPDATE partes_medicos
         SET registrado = ?, id_ina_generada = ?, fecha_actualizacion = NOW()
       WHERE cod_parte = ?`,
      [registrado, registrado === 'S' ? id_ina_generada : null, codParte]
    );

    res.status(200).json({ message: 'Parte médico actualizado', codParte: Number(codParte), registrado });
  } catch (error) {
    console.error('Error al actualizar el registro del parte médico:', error);
    res.status(500).json({ error: 'Error al actualizar el parte médico' });
  }
};

// Motivo del parte (motina.codina) con el formato de 2 dígitos que usa `inasist.mot`
const motivoInasistencia = (motivoCod) => String(motivoCod).padStart(2, '0');

// Gestiona un parte médico creando/completando su inasistencia, todo en una
// transacción (si algo falla no queda una inasistencia sin el parte marcado):
//  - Abierto (A) y registrado='N': crea la inasistencia Pendiente. Como en un
//    parte abierto las fechas vienen invertidas, el inicio real es la menor de
//    las dos y el fin provisorio la mayor. Deja el parte en
//    registrado='P' (parcial), guardando el id de la inasistencia.
//  - Cerrado (C) y registrado='P': completa la inasistencia existente con la
//    fechas definitivas (los días se derivan de las fechas), la pasa a
//    Aceptada y deja el parte en 'S'.
//  - Cerrado (C) y registrado='N' (llegó cerrado sin gestionar): crea la
//    inasistencia Aceptada con las fechas reales y deja el parte en 'S'.
// Abierto y ya 'P' no tiene nada para hacer hasta que el parte cierre.
export const gestionarParte = async (req, res) => {
  const { codParte } = req.params;
  const { nr } = req.body; // afectación de haberes: 'CG' (sin afectación) o 'SG' (con afectación)

  const db = await connect();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [partes] = await conn.query(
      `SELECT cod_parte, legajo, motivo_cod, estado, registrado, id_ina_generada,
              DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fi, DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS ff
         FROM partes_medicos WHERE cod_parte = ? FOR UPDATE`,
      [codParte]
    );
    if (partes.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Parte médico no encontrado' });
    }
    const parte = partes[0];

    if (parte.registrado !== 'N' && parte.registrado !== 'P') {
      await conn.rollback();
      return res.status(409).json({ error: `El parte ya fue procesado (registrado='${parte.registrado}')` });
    }

    let registradoNuevo;
    let idIna;

    if (parte.registrado === 'P') {
      if (parte.estado !== 'C') {
        await conn.rollback();
        return res.status(409).json({ error: 'El parte sigue abierto y ya tiene su inasistencia pendiente; se completa cuando cierre.' });
      }
      if (!parte.id_ina_generada) {
        await conn.rollback();
        return res.status(409).json({ error: 'El parte está en estado parcial pero no tiene inasistencia enlazada.' });
      }
      const [upd] = await conn.query(
        `UPDATE inasist SET fechcom = ?, fechfin = ?, estado = 'A' WHERE id_ina = ? AND nleg = ?`,
        [parte.fi, parte.ff, parte.id_ina_generada, parte.legajo]
      );
      if (upd.affectedRows === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'No se encontró la inasistencia enlazada al parte.' });
      }
      idIna = parte.id_ina_generada;
      registradoNuevo = 'S';
    } else {
      if (!parte.motivo_cod) {
        await conn.rollback();
        return res.status(400).json({ error: 'El parte no tiene un motivo mapeado; no se puede generar la inasistencia.' });
      }
      if (!['CG', 'SG'].includes(nr)) {
        await conn.rollback();
        return res.status(400).json({ error: "nr (afectación de haberes) debe ser 'CG' o 'SG'" });
      }
      const abierto = parte.estado === 'A';
      // Fechas ISO (yyyy-mm-dd): comparar como texto equivale a comparar fechas.
      const fechaCom = abierto && parte.ff < parte.fi ? parte.ff : parte.fi;
      const fechaFin = abierto ? (parte.ff < parte.fi ? parte.fi : parte.ff) : parte.ff;
      const [ins] = await conn.query(
        `INSERT INTO inasist (nleg, nc, mot, r, fechcom, fechfin, nres, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [parte.legajo, 999, motivoInasistencia(parte.motivo_cod), nr, fechaCom, fechaFin,
          String(parte.cod_parte), abierto ? 'P' : 'A']
      );
      idIna = ins.insertId;
      registradoNuevo = abierto ? 'P' : 'S';
    }

    await conn.query(
      `UPDATE partes_medicos
          SET registrado = ?, id_ina_generada = ?, fecha_actualizacion = NOW()
        WHERE cod_parte = ?`,
      [registradoNuevo, idIna, codParte]
    );

    await conn.commit();
    res.status(200).json({ message: 'Parte médico gestionado', codParte: Number(codParte), registrado: registradoNuevo, id_ina: idIna });
  } catch (error) {
    await conn.rollback();
    console.error('Error al gestionar el parte médico:', error);
    res.status(500).json({ error: 'Error al gestionar el parte médico', detalle: error.message });
  } finally {
    conn.release();
  }
};

// Guarda el documento subido y actualiza `ruta_documento`. Si el cod_parte no
// existe, `crearSubidorDocumento` borra el archivo recién subido (lanza y
// no deja huérfanos en disco).
export const subirDocumentoParte = subirDocumento(async (req, res) => {
  const { codParte } = req.params;
  const db = await connect();
  const [partes] = await db.query('SELECT id FROM partes_medicos WHERE cod_parte = ?', [codParte]);

  if (partes.length === 0) {
    fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Parte médico no encontrado' });
  }

  const rutaRelativa = path.join('uploads', 'partes_medicos', req.file.filename);
  await db.query(
    'UPDATE partes_medicos SET ruta_documento = ?, fecha_actualizacion = NOW() WHERE cod_parte = ?',
    [rutaRelativa, codParte]
  );

  res.status(200).json({ message: 'Documento asociado correctamente', ruta_documento: rutaRelativa });
});
