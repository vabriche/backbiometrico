import { connect } from '../database.js';
import { filtrarColumnasPermitidas } from '../utils/validaciones.js';
import { crearSubidorDocumento } from '../utils/subirDocumento.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAIZ_PROYECTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR_DOCUMENTOS = path.resolve(RAIZ_PROYECTO, 'uploads', 'solicitudes');
const subirDocumento = crearSubidorDocumento(DIR_DOCUMENTOS, (req) => req.params.id);

// Solo estado y observación se pueden modificar una vez creada la solicitud
// (ver tabla dbasistencia.solicitudes_justificacion — no hay borrado, el
// historial de pedidos se conserva siempre).
const COLUMNAS_SOLICITUD = ['estado', 'observacion'];
const TIPOS_VALIDOS = ['I', 'L'];
const ESTADOS_VALIDOS = ['P', 'A', 'R', 'C'];
const COMUNICO_VALIDOS = ['S', 'N'];

// Solicitudes pendientes de gestionar (estado='P'), con legajo->apellido y
// codina->motivo ya resueltos para no mostrar códigos crudos en el frontend.
export const getSolicitudesPendientes = async (req, res) => {
    const strqry = `
        SELECT sj.id, sj.legajo, ag.apellido,
               DATE_FORMAT(sj.fecha_creacion, "%d-%m-%Y") as fecha,
               sj.tipo, sj.codina, mo.Motivo as motivoDesc,
               sj.comunico, sj.observacion, sj.estado,
               sj.ruta_documento, sj.dias_solicitados, sj.cargo_id
        FROM dbasistencia.solicitudes_justificacion sj
        LEFT JOIN agentes ag ON ag.legajo = sj.legajo
        LEFT JOIN motina mo ON mo.codina = sj.codina
        WHERE sj.estado = 'P'
        ORDER BY sj.fecha_creacion DESC
    `;
    try {
        const db = await connect();
        const [rows] = await db.query(strqry);
        res.send(rows);
    } catch (error) {
        console.error('Error al listar solicitudes pendientes:', error);
        res.status(500).json({ error: 'Error al listar solicitudes pendientes' });
    }
};

// alta: crea una solicitud de justificación, siempre en estado Pendiente.
// `comunico` (S/N) se define acá y no se puede modificar después — registra
// si el agente avisó o no a su jefe superior al momento del pedido.
export const crearSolicitudJustificacion = async (req, res) => {
    try {
        const { legajo, codina, cargo_id, tipo, comunico, observacion, dias_solicitados } = req.body;

        if (!legajo || !codina || !tipo || !comunico) {
            return res.status(400).json({ error: 'legajo, codina, tipo y comunico son requeridos' });
        }
        if (!TIPOS_VALIDOS.includes(tipo)) {
            return res.status(400).json({ error: "tipo debe ser 'I' (Inasistencia) o 'L' (Licencia)" });
        }
        if (!COMUNICO_VALIDOS.includes(comunico)) {
            return res.status(400).json({ error: "comunico debe ser 'S' o 'N'" });
        }

        const query = `
            INSERT INTO dbasistencia.solicitudes_justificacion (legajo, codina, cargo_id, tipo, comunico, observacion, dias_solicitados)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [legajo, codina, cargo_id ?? null, tipo, comunico, observacion ?? null, dias_solicitados ?? null];

        const db = await connect();
        const [result] = await db.query(query, values);

        res.status(201).json({ message: 'Solicitud creada correctamente', id: result.insertId });
    } catch (error) {
        console.error('Error al crear la solicitud de justificación:', error);
        res.status(500).json({ error: 'Error al crear la solicitud' });
    }
};

// modificación: únicamente estado y observación. No hay endpoint de borrado
// a propósito — el pedido queda como registro histórico (Aceptado/Rechazado/
// Cancelado), nunca se elimina.
export const actualizarSolicitudJustificacion = async (req, res) => {
    try {
        const { id } = req.params;
        const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_SOLICITUD);

        if (Object.keys(cambios).length === 0) {
            return res.status(400).json({ error: 'No se recibió estado ni observación para modificar' });
        }
        if (cambios.estado && !ESTADOS_VALIDOS.includes(cambios.estado)) {
            return res.status(400).json({ error: "estado debe ser 'P', 'A', 'R' o 'C'" });
        }

        const db = await connect();
        const [result] = await db.query(
            'UPDATE dbasistencia.solicitudes_justificacion SET ? WHERE id = ?',
            [cambios, id]
        );

        if (result.affectedRows > 0) {
            res.status(200).json({ message: 'Solicitud actualizada correctamente' });
        } else {
            res.status(404).json({ message: 'Solicitud no encontrada' });
        }
    } catch (error) {
        console.error('Error al actualizar la solicitud de justificación:', error);
        res.status(500).json({ error: 'Error al actualizar la solicitud' });
    }
};

// Gestión de una solicitud pendiente, todo en una transacción:
//  - accion 'aceptar': carga la ausencia (tipo 'I' -> inasistencia sin cargo, nc 999, como los partes médicos;
//    tipo 'L' -> licencia sobre un cargo vigente del agente, que además marca la situación del cargo) y deja
//    la solicitud en estado 'A' (aceptada).
//  - accion 'rechazar': deja la solicitud en 'R', agregando el motivo a la observación.
// Solo se gestionan solicitudes en estado 'P'. El motivo sale de la solicitud (codina).
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export const gestionarSolicitudJustificacion = async (req, res) => {
    const { id } = req.params;
    const { accion, fechaini, fechafin, nrores, nr, cargo_id, motivoRechazo } = req.body;

    if (!['aceptar', 'rechazar'].includes(accion)) {
        return res.status(400).json({ error: "accion debe ser 'aceptar' o 'rechazar'" });
    }

    const db = await connect();
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [solicitudes] = await conn.query(
            'SELECT id, legajo, codina, cargo_id, tipo, estado, observacion FROM dbasistencia.solicitudes_justificacion WHERE id = ? FOR UPDATE',
            [id]
        );
        if (solicitudes.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }
        const sol = solicitudes[0];
        if (sol.estado !== 'P') {
            await conn.rollback();
            return res.status(409).json({ error: `La solicitud ya fue gestionada (estado '${sol.estado}')` });
        }

        if (accion === 'rechazar') {
            const motivo = String(motivoRechazo ?? '').trim();
            if (!motivo) {
                await conn.rollback();
                return res.status(400).json({ error: 'Indicá el motivo del rechazo' });
            }
            const observacion = `${sol.observacion ? `${sol.observacion} | ` : ''}Rechazada: ${motivo}`.slice(0, 255);
            await conn.query('UPDATE dbasistencia.solicitudes_justificacion SET estado = ?, observacion = ? WHERE id = ?', ['R', observacion, id]);
            await conn.commit();
            return res.status(200).json({ message: 'Solicitud rechazada', estado: 'R' });
        }

        // aceptar
        if (!sol.codina) {
            await conn.rollback();
            return res.status(400).json({ error: 'La solicitud no tiene motivo: no se puede generar la ausencia.' });
        }
        if (!FECHA_ISO.test(String(fechaini ?? '')) || !FECHA_ISO.test(String(fechafin ?? '')) || fechafin < fechaini) {
            await conn.rollback();
            return res.status(400).json({ error: 'fechaini y fechafin deben ser fechas válidas (aaaa-mm-dd) y la fecha fin no puede ser anterior al inicio' });
        }
        const resolucion = String(nrores ?? '').trim();
        if (resolucion.length < 1 || resolucion.length > 20) {
            await conn.rollback();
            return res.status(400).json({ error: 'nrores (nro. de resolución) es obligatorio, de hasta 20 caracteres' });
        }
        if (!['CG', 'SG'].includes(nr)) {
            await conn.rollback();
            return res.status(400).json({ error: "nr (afectación de haberes) debe ser 'CG' o 'SG'" });
        }
        const motivo = String(sol.codina).padStart(2, '0');

        let generado;
        if (sol.tipo === 'I') {
            const [ins] = await conn.query(
                `INSERT INTO inasist (nleg, nc, mot, r, fechcom, fechfin, nres, estado) VALUES (?, ?, ?, ?, ?, ?, ?, 'A')`,
                [sol.legajo, 999, motivo, nr, fechaini, fechafin, resolucion]
            );
            generado = { id_ina: ins.insertId };
        } else {
            const cargoElegido = cargo_id ?? sol.cargo_id;
            if (!cargoElegido) {
                await conn.rollback();
                return res.status(400).json({ error: 'Elegí el cargo sobre el que se carga la licencia' });
            }
            const [cargos] = await conn.query(
                "SELECT nc, ncg FROM cargos WHERE row_id = ? AND legajo = ? AND vigente = 'S'",
                [cargoElegido, sol.legajo]
            );
            if (cargos.length === 0) {
                await conn.rollback();
                return res.status(400).json({ error: 'El cargo elegido no es un cargo vigente del agente' });
            }
            const { nc, ncg } = cargos[0];
            const [ins] = await conn.query(
                `INSERT INTO licencia (nleg, nc, mot, r, fechcom, fechfin, nres, ncg, observaciones) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [sol.legajo, nc, motivo, nr, fechaini, fechafin, resolucion, ncg, sol.observacion ?? null]
            );
            // igual que la carga manual de licencias: el cargo pasa a figurar con la situación (CG/SG)
            await conn.query('UPDATE cargos SET st = ? WHERE legajo = ? AND nc = ? AND ncg = ?', [nr, sol.legajo, nc, ncg]);
            generado = { id_lic: ins.insertId };
        }

        await conn.query('UPDATE dbasistencia.solicitudes_justificacion SET estado = ? WHERE id = ?', ['A', id]);
        await conn.commit();
        res.status(200).json({ message: 'Solicitud aceptada', estado: 'A', ...generado });
    } catch (error) {
        await conn.rollback();
        console.error('Error al gestionar la solicitud de justificación:', error);
        res.status(500).json({ error: 'Error al gestionar la solicitud', detalle: error.message });
    } finally {
        conn.release();
    }
};

// Documento probatorio asociado a una solicitud (cuando el motivo lo
// requiera). No es obligatorio para ningún tipo/motivo por ahora: se permite
// adjuntar a cualquier solicitud, sin bloquear su creación ni su estado si no
// lo tiene.
export const subirDocumentoSolicitud = subirDocumento(async (req, res) => {
    const { id } = req.params;
    const db = await connect();
    const [solicitudes] = await db.query('SELECT id FROM dbasistencia.solicitudes_justificacion WHERE id = ?', [id]);

    if (solicitudes.length === 0) {
        fs.unlink(req.file.path, () => {});
        return res.status(404).json({ error: 'Solicitud no encontrada' });
    }

    const rutaRelativa = path.join('uploads', 'solicitudes', req.file.filename);
    await db.query(
        'UPDATE dbasistencia.solicitudes_justificacion SET ruta_documento = ? WHERE id = ?',
        [rutaRelativa, id]
    );

    res.status(200).json({ message: 'Documento asociado correctamente', ruta_documento: rutaRelativa });
});
