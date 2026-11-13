import { connect } from '../database.js';
import { filtrarColumnasPermitidas } from '../utils/validaciones.js';
import { crearSubidorDocumento } from '../utils/subirDocumento.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAIZ_PROYECTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR_DOCUMENTOS = path.resolve(RAIZ_PROYECTO, 'uploads', 'solicitudes');
const subirDocumento = crearSubidorDocumento(DIR_DOCUMENTOS, (req) => req.params.id);

// Solo estado, observación y motivo_cancelacion se pueden modificar una vez creada la solicitud
// (ver tabla solicitudes_justificacion — no hay borrado, el
// historial de pedidos se conserva siempre).
const COLUMNAS_SOLICITUD = ['estado', 'observacion', 'motivo_cancelacion'];
const TIPOS_VALIDOS = ['I', 'L'];
const ESTADOS_VALIDOS = ['P', 'A', 'R', 'C'];
const COMUNICO_VALIDOS = ['S', 'N'];
const MOTIVOS_HABILITADOS_IDS = [2, 4, 31, 7, 8, 11, 13, 14, 15, 19, 23, 25, 26, 32, 36];
const MOTIVOS_DOC_IDS = [2, 7, 8, 11, 13, 14, 15, 19, 23, 25, 36];
const MOTIVOS_NO_DOC_IDS = [4, 31, 26, 32];

// Categorías que exigen comprobante documental
const CATEGORIAS_CON_JUSTIFICATIVO = [
    "Asistencia a reuniones de carácter académico (Congresos, Simposios, etc.)",
    "Donación de sangre",
    "Para rendir exámenes",
    "Integrar mesas examinadoras",
    "Trámites",
    "Asistencia a tribunales",
    "Licencia Paternidad",
    "Fallecimiento Familiar",
    "Actividades deportivas o artísticas",
    "Por matrimonio",
    "Por matrimonio de un hijo",
    "Congresos",
    "Donación sangre",
    "Donación de Sangre",
    "Estudio",
    "Mesa examinadora",
    "Mesa Examinadora",
    "Trámites",
    "Nacimiento",
    "Fallecimiento",
    "Actividad deportiva",
    "Actividad Deportiva",
    "Matrimonio",
    "Licencia Extraordinaria 25",
    "Licencia extraordinaria 25",
    "Sindical",
];

const normalizarTexto = (texto) =>
    String(texto || '')
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();

const requiereDocumentoJustificativo = (motivoTexto, codina) => {
    // 1. Verificación por codina
    if (codina !== undefined && codina !== null && String(codina).trim() !== '') {
        const cod = Number(codina);
        if (MOTIVOS_DOC_IDS.includes(cod)) return true;
        if (MOTIVOS_NO_DOC_IDS.includes(cod)) return false;
    }

    if (!motivoTexto) return false;
    const norm = normalizarTexto(motivoTexto);

    // Exclusiones explícitas (sin comprobante)
    if (
        norm.includes("sin goce") ||
        norm.includes("con goce") ||
        norm.includes("razones particulares") ||
        norm.includes("razon particular") ||
        norm.includes("compensacion") ||
        norm.includes("102") ||
        norm.includes("excepcional")
    ) {
        return false;
    }

    for (const cat of CATEGORIAS_CON_JUSTIFICATIVO) {
        const catNorm = normalizarTexto(cat);
        if (norm === catNorm || norm.includes(catNorm) || catNorm.includes(norm)) {
            return true;
        }
    }
    const keywords = [
        "congreso", "simposio", "reuniones de caracter academico",
        "donacion sangre", "donacion de sangre", "rendir examen",
        "examenes", "estudio", "mesa examinadora", "mesas examinadoras",
        "tramite", "tramites", "tribunal", "tribunales",
        "paternidad", "fallecimiento", "actividad deportiva",
        "actividades deportivas", "artistica", "matrimonio",
        "sindical", "licencia extraordinaria",
    ];
    return keywords.some((kw) => norm.includes(kw));
};

// Límites y cupos de justificación
const REGLAS_CUPO = {
    RAZONES_PARTICULARES: {
        tipo: 'RAZONES_PARTICULARES',
        nombre: 'Razones Particulares con goce',
        maxAnual: 6,
        maxMensual: 2,
        maxPorSolicitud: 2,
        descripcion: '6 días al año (máx. 2 por mes)',
    },
    EXCEPCIONALES: {
        tipo: 'EXCEPCIONALES',
        nombre: 'Permisos Excepcionales (Art. 102)',
        maxAnual: 5,
        maxMensual: 2,
        maxPorSolicitud: 2,
        descripcion: '5 días al año (máx. 2 por mes)',
    },
    ESTUDIO: {
        tipo: 'ESTUDIO',
        nombre: 'Estudio',
        maxAnual: 28,
        maxMensual: null,
        maxPorSolicitud: 5,
        descripcion: '28 días anuales (máx. 5 por examen)',
    },
};

const obtenerReglaCupo = (motivoTexto, codina) => {
    if (codina !== undefined && codina !== null && String(codina).trim() !== '') {
        const cod = Number(codina);
        if (cod === 4) return REGLAS_CUPO.RAZONES_PARTICULARES;
        if (cod === 32) return REGLAS_CUPO.EXCEPCIONALES;
        if (cod === 2) return REGLAS_CUPO.ESTUDIO;
        if (cod === 31) return null; // Razones particulares sin goce no tiene cupo de 6 días
    }

    if (!motivoTexto) return null;
    const norm = normalizarTexto(motivoTexto);

    if (norm.includes('sin goce')) {
        return null;
    }

    if (norm.includes('mesa examinadora') || norm.includes('mesas examinadoras')) {
        return null;
    }

    if (
        norm.includes('razones particulares') ||
        norm.includes('razon particular') ||
        norm.includes('motivos particulares')
    ) {
        return REGLAS_CUPO.RAZONES_PARTICULARES;
    }

    if (
        norm.includes('excepcional') ||
        norm.includes('excepcionales') ||
        norm.includes('102')
    ) {
        return REGLAS_CUPO.EXCEPCIONALES;
    }

    if (
        norm.includes('estudio') ||
        norm.includes('rendir examen') ||
        norm.includes('rendir examenes') ||
        norm.includes('examen')
    ) {
        return REGLAS_CUPO.ESTUDIO;
    }

    return null;
};

// Asegurar columnas en solicitudes_justificacion
let columnasVerificadas = false;
const asegurarColumnasSolicitud = async (db) => {
    if (columnasVerificadas) return;
    try {
        const [cols] = await db.query(
            "SHOW COLUMNS FROM solicitudes_justificacion"
        );
        const nombresCols = cols.map(c => c.Field.toLowerCase());

        if (!nombresCols.includes('motivo_cancelacion')) {
            await db.query("ALTER TABLE solicitudes_justificacion ADD COLUMN motivo_cancelacion TEXT NULL");
            console.log("Columna motivo_cancelacion creada exitosamente");
        }
        if (!nombresCols.includes('fecha_inicio')) {
            await db.query("ALTER TABLE solicitudes_justificacion ADD COLUMN fecha_inicio DATE NULL");
            console.log("Columna fecha_inicio creada exitosamente");
        }
        if (!nombresCols.includes('fecha_fin')) {
            await db.query("ALTER TABLE solicitudes_justificacion ADD COLUMN fecha_fin DATE NULL");
            console.log("Columna fecha_fin creada exitosamente");
        }
        if (!nombresCols.includes('cantidad_dias')) {
            await db.query("ALTER TABLE solicitudes_justificacion ADD COLUMN cantidad_dias INT NULL");
            console.log("Columna cantidad_dias creada exitosamente");
        }
        if (nombresCols.includes('dias_solicitados')) {
            try {
                await db.query("DELETE FROM solicitudes_justificacion WHERE fecha_inicio IS NULL");
                await db.query("ALTER TABLE solicitudes_justificacion DROP COLUMN dias_solicitados");
                console.log("Columna dias_solicitados eliminada y registros viejos limpiados");
            } catch (dropErr) {
                console.warn("Aviso al intentar limpiar/eliminar columna dias_solicitados:", dropErr.message);
            }
        }
        columnasVerificadas = true;
    } catch (err) {
        console.warn("Aviso: No se pudieron verificar/agregar columnas automáticamente:", err.message);
    }
};

// Solicitudes de un estado (?estado=P|A|R|C|G; por defecto A, las aceptadas que RRHH tiene
// que gestionar), con legajo->apellido y codina->motivo ya resueltos para no mostrar códigos
// crudos en el frontend.
const ESTADOS_LISTADO = ['P', 'A', 'R', 'C', 'G', 'D'];

export const getSolicitudesPendientes = async (req, res) => {
    const estado = String(req.query.estado ?? 'A').toUpperCase();
    if (!ESTADOS_LISTADO.includes(estado)) {
        return res.status(400).json({ error: "estado debe ser 'P', 'A', 'R', 'C', 'G' o 'D'" });
    }
    const strqry = `
        SELECT sj.id, sj.legajo, ag.apellido,
               DATE_FORMAT(sj.fecha_creacion, "%d-%m-%Y") as fecha,
               sj.tipo, sj.codina, mo.Motivo as motivoDesc,
               sj.comunico, sj.observacion, sj.estado,
               sj.documento, sj.cargo_id,
               sj.motivo_cancelacion, sj.id_ina,
               DATE_FORMAT(ina.fechfin, "%Y-%m-%d") as ina_fecha_fin,
               DATE_FORMAT(sj.fecha_inicio, "%Y-%m-%d") as fecha_inicio,
               DATE_FORMAT(sj.fecha_fin, "%Y-%m-%d") as fecha_fin,
               sj.cantidad_dias
        FROM solicitudes_justificacion sj
        LEFT JOIN agentes ag ON ag.legajo = sj.legajo
        LEFT JOIN motina mo ON mo.codina = sj.codina
        LEFT JOIN inasist ina ON ina.id_ina = sj.id_ina
        WHERE sj.estado = ?
        ORDER BY sj.fecha_creacion DESC
    `;
    try {
        const db = await connect();
        await asegurarColumnasSolicitud(db);
        const [rows] = await db.query(strqry, [estado]);
        res.send(rows.map((r) => ({ ...r, requiere_documento: requiereDocumentoJustificativo(r.motivoDesc, r.codina) })));
    } catch (error) {
        console.error('Error al listar solicitudes:', error);
        res.status(500).json({ error: 'Error al listar las solicitudes' });
    }
};

// Traer solicitudes de un legajo específico
export const getSolicitudesPorLegajo = async (req, res) => {
    const { legajo } = req.params;
    const strqry = `
        SELECT sj.id, sj.legajo, ag.apellido,
               DATE_FORMAT(sj.fecha_creacion, "%d-%m-%Y") as fecha,
               sj.tipo, sj.codina, mo.Motivo as motivoDesc,
               sj.comunico, sj.observacion, sj.estado,
               sj.documento, sj.cargo_id,
               sj.motivo_cancelacion,
               DATE_FORMAT(sj.fecha_inicio, "%Y-%m-%d") as fecha_inicio,
               DATE_FORMAT(sj.fecha_fin, "%Y-%m-%d") as fecha_fin,
               sj.cantidad_dias
        FROM solicitudes_justificacion sj
        LEFT JOIN agentes ag ON ag.legajo = sj.legajo
        LEFT JOIN motina mo ON mo.codina = sj.codina
        WHERE sj.legajo = ?
        ORDER BY sj.fecha_creacion DESC
    `;
    try {
        const db = await connect();
        await asegurarColumnasSolicitud(db);
        const [rows] = await db.query(strqry, [legajo]);
        res.send(rows);
    } catch (error) {
        console.error('Error al listar solicitudes por legajo:', error);
        res.status(500).json({ error: 'Error al listar solicitudes' });
    }
};

// Obtener lista de áreas (para titulares)
export const getAreasAgentes = async (req, res) => {
    try {
        const db = await connect();
        const [rows] = await db.query('SELECT DISTINCT area FROM agentes WHERE area IS NOT NULL AND area != "" ORDER BY area');
        const areas = rows.map(r => r.area);
        res.send(areas);
    } catch (error) {
        console.error('Error al obtener áreas:', error);
        res.status(500).json({ error: 'Error al obtener áreas' });
    }
};

// Traer solicitudes de un área específica (o TODAS para el titular)
export const getSolicitudesPorArea = async (req, res) => {
    const { area } = req.params;
    let strqry = `
        SELECT sj.id, sj.legajo, ag.apellido,
               DATE_FORMAT(sj.fecha_creacion, "%d-%m-%Y") as fecha,
               sj.tipo, sj.codina, mo.Motivo as motivoDesc,
               sj.comunico, sj.observacion, sj.estado,
               sj.documento, sj.cargo_id,
               sj.motivo_cancelacion,
               DATE_FORMAT(sj.fecha_inicio, "%Y-%m-%d") as fecha_inicio,
               DATE_FORMAT(sj.fecha_fin, "%Y-%m-%d") as fecha_fin,
               sj.cantidad_dias
        FROM solicitudes_justificacion sj
        INNER JOIN agentes ag ON ag.legajo = sj.legajo
        LEFT JOIN motina mo ON mo.codina = sj.codina
    `;
    const params = [];
    if (area !== 'TODAS') {
        strqry += ' WHERE ag.area = ? ';
        params.push(area);
    }
    strqry += " ORDER BY sj.estado = 'P' DESC, sj.fecha_creacion DESC ";
    
    try {
        const db = await connect();
        await asegurarColumnasSolicitud(db);
        const [rows] = await db.query(strqry, params);
        res.send(rows);
    } catch (error) {
        console.error('Error al listar solicitudes por área:', error);
        res.status(500).json({ error: 'Error al listar solicitudes por área' });
    }
};

// alta: crea una solicitud de justificación, siempre en estado Pendiente.
// `comunico` (S/N) se define acá y no se puede modificar después — registra
// si el agente avisó o no a su jefe superior al momento del pedido.
export const crearSolicitudJustificacion = async (req, res) => {
    try {
        const {
            legajo,
            codina,
            cargo_id,
            tipo,
            comunico,
            observacion,
            fecha_inicio,
            fecha_fin,
        } = req.body;

        if (!legajo || !codina || !tipo || !comunico) {
            return res.status(400).json({ error: 'legajo, codina, tipo y comunico son requeridos' });
        }
        if (!MOTIVOS_HABILITADOS_IDS.includes(Number(codina))) {
            return res.status(400).json({ error: 'El motivo seleccionado no está habilitado para solicitudes de justificación' });
        }
        if (!fecha_inicio) {
            return res.status(400).json({ error: 'La fecha de inicio es requerida' });
        }
        if (!TIPOS_VALIDOS.includes(tipo)) {
            return res.status(400).json({ error: "tipo debe ser 'I' (Inasistencia) o 'L' (Licencia)" });
        }
        if (!COMUNICO_VALIDOS.includes(comunico)) {
            return res.status(400).json({ error: "comunico debe ser 'S' o 'N'" });
        }

        const fechaFinal = fecha_fin || fecha_inicio;
        if (fechaFinal < fecha_inicio) {
            return res.status(400).json({ error: 'La fecha de fin no puede ser anterior a la fecha de inicio' });
        }

        const db = await connect();

        await asegurarColumnasSolicitud(db);

        // Cantidad de días hábiles del período (sin sábados ni domingos). Se calcula siempre acá,
        // no se toma la del cliente, porque con ella se controlan los cupos.
        const d1 = new Date(fecha_inicio + 'T00:00:00');
        const d2 = new Date(fechaFinal + 'T00:00:00');
        let cantDiasCalculada = 0;
        for (const d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)) {
            if (d.getDay() !== 0 && d.getDay() !== 6) cantDiasCalculada++;
        }
        if (cantDiasCalculada === 0) {
            return res.status(400).json({ error: 'El período elegido no incluye días hábiles (solo sábado y/o domingo)' });
        }

        // Obtener descripción del motivo para validar cupos y límites legales
        const [motivoRows] = await db.query(
            'SELECT codina, Motivo FROM motina WHERE codina = ?',
            [codina]
        );
        const motivoDesc = motivoRows[0]?.Motivo || '';
        const regla = obtenerReglaCupo(motivoDesc, codina);

        if (regla) {
            // 1. Límite por solicitud
            if (regla.maxPorSolicitud && cantDiasCalculada > regla.maxPorSolicitud) {
                if (regla.tipo === 'ESTUDIO') {
                    return res.status(400).json({
                        error: `No puedes solicitar más de ${regla.maxPorSolicitud} días por examen para ${regla.nombre}.`,
                    });
                }
                return res.status(400).json({
                    error: `No puedes solicitar más de ${regla.maxPorSolicitud} días por mes para ${regla.nombre}.`,
                });
            }

            const anioSolicitud = d1.getFullYear();
            const mesSolicitud = d1.getMonth() + 1;

            // Consultar solicitudes previas en estado Pendiente ('P'), Aceptado ('A') o Gestionada ('G') en el mismo año
            const [solicitudesAnio] = await db.query(
                `SELECT sj.id, sj.codina, mo.Motivo as motivoDesc,
                        DATE_FORMAT(sj.fecha_inicio, "%Y-%m-%d") as fecha_inicio,
                        DATE_FORMAT(sj.fecha_fin, "%Y-%m-%d") as fecha_fin,
                        sj.cantidad_dias
                 FROM solicitudes_justificacion sj
                 LEFT JOIN motina mo ON mo.codina = sj.codina
                 WHERE sj.legajo = ?
                   AND sj.estado IN ('P', 'A', 'G', 'D')
                   AND YEAR(sj.fecha_inicio) = ?`,
                [legajo, anioSolicitud]
            );

            // Filtrar solo las solicitudes que corresponden a la misma categoría/regla
            const solMismaRegla = solicitudesAnio.filter(r => {
                const rRegla = obtenerReglaCupo(r.motivoDesc, r.codina);
                return rRegla && rRegla.tipo === regla.tipo;
            });

            // 2. Validación cupo anual
            const diasUsadosAnio = solMismaRegla.reduce((acc, r) => acc + (r.cantidad_dias || 1), 0);
            if (regla.maxAnual && (diasUsadosAnio + cantDiasCalculada > regla.maxAnual)) {
                const restantes = Math.max(0, regla.maxAnual - diasUsadosAnio);
                return res.status(400).json({
                    error: `Supera el cupo anual para ${regla.nombre}. Límite: ${regla.maxAnual} días al año. Ya tienes ${diasUsadosAnio} día(s) solicitados/aprobados en ${anioSolicitud}. Te quedan disponibles ${restantes} día(s).`,
                });
            }

            // 3. Validación cupo mensual
            if (regla.maxMensual) {
                const diasUsadosMes = solMismaRegla
                    .filter(r => {
                        if (!r.fecha_inicio) return false;
                        const mesReq = parseInt(r.fecha_inicio.split('-')[1], 10);
                        return mesReq === mesSolicitud;
                    })
                    .reduce((acc, r) => acc + (r.cantidad_dias || 1), 0);

                if (diasUsadosMes + cantDiasCalculada > regla.maxMensual) {
                    const restantesMes = Math.max(0, regla.maxMensual - diasUsadosMes);
                    return res.status(400).json({
                        error: `Supera el cupo mensual para ${regla.nombre}. Límite: ${regla.maxMensual} días por mes. Ya tienes ${diasUsadosMes} día(s) solicitados/aprobados en este mes. Te quedan disponibles ${restantesMes} día(s).`,
                    });
                }
            }
        }

        const query = `
            INSERT INTO solicitudes_justificacion 
            (legajo, codina, cargo_id, tipo, comunico, observacion, fecha_inicio, fecha_fin, cantidad_dias)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [
            legajo,
            codina,
            cargo_id ?? null,
            tipo,
            comunico,
            observacion ?? null,
            fecha_inicio,
            fechaFinal,
            cantDiasCalculada,
        ];
        const [resInsert] = await db.query(query, values);

        res.status(201).json({ message: 'Solicitud creada correctamente', id: resInsert.insertId });
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
        await asegurarColumnasSolicitud(db);

        // Una solicitud gestionada ('G') ya tiene cargada su inasistencia o licencia: su estado
        // no se cambia desde acá (para anularla, se da de baja la inasistencia o la licencia).
        if (cambios.estado) {
            const [actual] = await db.query('SELECT estado FROM solicitudes_justificacion WHERE id = ?', [id]);
            if (actual[0]?.estado === 'G' || actual[0]?.estado === 'D') {
                return res.status(400).json({ error: 'La solicitud ya fue gestionada por RRHH (su inasistencia está cargada): su estado no se puede cambiar' });
            }
        }

        // Aceptar ('A') es la conformidad del supervisor y no exige el documento probatorio: el agente
        // puede subirlo después (p. ej. el certificado de un examen). El documento lo exige RRHH al
        // gestionar la solicitud (más abajo, en la gestión de RRHH).

        // Si se intenta cancelar la solicitud ('C'), validar que no haya pasado el período solicitado
        // y si ya estaba Aprobada ('A'), exigir obligatoriamente el motivo de cancelación
        if (cambios.estado === 'C') {
            const [solActual] = await db.query(
                `SELECT estado, fecha_creacion, observacion,
                        DATE_FORMAT(fecha_inicio, '%Y-%m-%d') as fecha_inicio,
                        DATE_FORMAT(fecha_fin, '%Y-%m-%d') as fecha_fin
                 FROM solicitudes_justificacion WHERE id = ?`,
                [id]
            );

            if (solActual.length === 0) {
                return res.status(404).json({ error: 'Solicitud no encontrada' });
            }

            const sol = solActual[0];
            if (sol.estado === 'C' || sol.estado === 'R') {
                return res.status(400).json({ error: 'La solicitud no se puede cancelar porque ya fue cancelada o rechazada' });
            }

            // Si estaba aceptada, es obligatorio ingresar el motivo de cancelación
            if (sol.estado === 'A') {
                if (!cambios.motivo_cancelacion || !cambios.motivo_cancelacion.trim()) {
                    return res.status(400).json({
                        error: 'Para cancelar una solicitud previamente aceptada, es obligatorio ingresar el motivo de cancelación'
                    });
                }
            }

            let fechaSol = null;
            if (sol.fecha_fin) {
                fechaSol = new Date(sol.fecha_fin + 'T00:00:00');
            } else if (sol.fecha_inicio) {
                fechaSol = new Date(sol.fecha_inicio + 'T00:00:00');
            } else if (sol.fecha_creacion) {
                fechaSol = new Date(sol.fecha_creacion);
                fechaSol.setHours(0, 0, 0, 0);
            }

            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);

            if (fechaSol && fechaSol < hoy) {
                return res.status(400).json({ error: 'No se puede cancelar una solicitud cuyo período solicitado ya ha pasado' });
            }
        }

        let result;
        try {
            const [resUpdate] = await db.query(
                'UPDATE solicitudes_justificacion SET ? WHERE id = ?',
                [cambios, id]
            );
            result = resUpdate;
        } catch (dbError) {
            // Si la columna motivo_cancelacion no existe todavía en la base, guardar en observacion como fallback
            if (dbError.code === 'ER_BAD_FIELD_ERROR' && cambios.motivo_cancelacion) {
                const motivoText = `[Motivo Cancelación]: ${cambios.motivo_cancelacion}`;
                const [obsRows] = await db.query('SELECT observacion FROM solicitudes_justificacion WHERE id = ?', [id]);
                const obsActual = obsRows[0]?.observacion;
                delete cambios.motivo_cancelacion;
                cambios.observacion = obsActual ? `${obsActual}\n${motivoText}` : motivoText;

                const [fallbackUpdate] = await db.query(
                    'UPDATE solicitudes_justificacion SET ? WHERE id = ?',
                    [cambios, id]
                );
                result = fallbackUpdate;
            } else {
                throw dbError;
            }
        }

        if (result && result.affectedRows > 0) {
            res.status(200).json({ message: 'Solicitud actualizada correctamente' });
        } else {
            res.status(404).json({ message: 'Solicitud no encontrada' });
        }
    } catch (error) {
        console.error('Error al actualizar la solicitud de justificación:', error);
        res.status(500).json({ error: 'Error al actualizar la solicitud' });
    }
};

// Documento probatorio asociado a una solicitud (cuando el motivo lo requiera). Se puede
// subir o reemplazar (si el agente se equivocó de archivo) mientras la solicitud está
// pendiente, aceptada o en gestión parcial. Gestionada, rechazada o cancelada ya no: en la
// gestionada RRHH registró la ausencia con ese documento.
const ESTADOS_CON_DOCUMENTO_EDITABLE = ['P', 'A', 'D'];

export const subirDocumentoSolicitud = subirDocumento(async (req, res) => {
    const { id } = req.params;
    const db = await connect();
    const [solicitudes] = await db.query('SELECT id, legajo, estado, documento FROM solicitudes_justificacion WHERE id = ?', [id]);

    if (solicitudes.length === 0) {
        fs.unlink(req.file.path, () => {});
        return res.status(404).json({ error: 'Solicitud no encontrada' });
    }
    const { legajo, estado, documento: anterior } = solicitudes[0];
    // Solo el agente dueño de la solicitud sube o reemplaza su documento. req.user lo deja
    // verifyTokenWrites (app.js) a partir del JWT; sin token válido no se llega hasta acá.
    const mismoLegajo = (a, b) => String(a).trim().replace(/^0+(?=\d)/, '') === String(b).trim().replace(/^0+(?=\d)/, '');
    if (!req.user?.legajo || !mismoLegajo(req.user.legajo, legajo)) {
        fs.unlink(req.file.path, () => {});
        return res.status(403).json({ error: 'Solo el agente que hizo la solicitud puede subir su documento' });
    }
    if (!ESTADOS_CON_DOCUMENTO_EDITABLE.includes(estado)) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'El documento ya no se puede cambiar: la solicitud fue gestionada, rechazada o cancelada' });
    }

    const rutaRelativa = path.join('uploads', 'solicitudes', req.file.filename);
    await db.query(
        'UPDATE solicitudes_justificacion SET documento = ? WHERE id = ?',
        [rutaRelativa, id]
    );

    // Si reemplazó uno anterior, se borra ese archivo (solo por nombre, dentro de la carpeta de documentos)
    if (anterior && String(anterior).trim()) {
        const archivoAnterior = path.join(DIR_DOCUMENTOS, path.basename(String(anterior).replace(/\\/g, '/')));
        if (archivoAnterior !== req.file.path) fs.unlink(archivoAnterior, () => {});
    }

    res.status(200).json({
        message: anterior ? 'Documento reemplazado correctamente' : 'Documento asociado correctamente',
        ruta_documento: rutaRelativa,
    });
});


// Gestión de RRHH de una solicitud aceptada ('A'), en una transacción: carga la ausencia
// (tipo 'I' -> inasistencia sin cargo, nc 999, como los partes médicos; tipo 'L' -> licencia
// sobre un cargo vigente del agente, que además marca la situación del cargo) y deja la
// solicitud en estado 'G' (gestionada). Para rechazarla o cancelarla se usa la modificación de
// estado, no esta gestión. El motivo sale de la solicitud (codina).
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

//
// Una inasistencia se gestiona a partir del día siguiente a su inicio. Gestión parcial ('D'): si
// todavía no terminó (fecha fin >= hoy) o su motivo exige documento probatorio y el agente no lo
// subió, se carga igual con estado 'P' (pendiente) y la solicitud queda 'D'. Cuando terminó y está
// el documento (si hace falta), accion 'completar' pasa la inasistencia a 'A' y la solicitud a 'G'.
// Las licencias no tienen estado pendiente: sin el documento no se registran.
export const gestionarSolicitudJustificacion = async (req, res) => {
    const { id } = req.params;
    const { accion, fechaini, fechafin, nrores, nr, cargo_id } = req.body;

    if (accion !== 'aceptar' && accion !== 'completar') {
        return res.status(400).json({ error: "accion debe ser 'aceptar' (carga la inasistencia o la licencia) o 'completar' (gestión parcial con el documento ya subido)" });
    }

    const db = await connect();
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [solicitudes] = await conn.query(
            `SELECT sj.id, sj.legajo, sj.codina, sj.cargo_id, sj.tipo, sj.estado, sj.observacion, sj.cantidad_dias,
                    sj.documento, sj.id_ina, mo.Motivo AS motivoDesc,
                    DATE_FORMAT(sj.fecha_inicio, '%Y-%m-%d') AS fecha_inicio_solicitada,
                    DATE_FORMAT(COALESCE(sj.fecha_fin, sj.fecha_inicio + INTERVAL GREATEST(IFNULL(sj.cantidad_dias, 1), 1) - 1 DAY),
                                '%Y-%m-%d') AS fecha_fin_solicitada
               FROM solicitudes_justificacion sj
               LEFT JOIN motina mo ON mo.codina = sj.codina
              WHERE sj.id = ? FOR UPDATE`,
            [id]
        );
        if (solicitudes.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }
        const sol = solicitudes[0];
        const tieneDocumento = String(sol.documento ?? '').trim() !== '';
        const faltaDocumento = requiereDocumentoJustificativo(sol.motivoDesc, sol.codina) && !tieneDocumento;
        const hoy = new Date().toLocaleDateString('sv-SE');
        const enDdMmAaaa = (iso) => iso.split('-').reverse().join('/');

        // Completar una gestión parcial: llegó el documento, la inasistencia pendiente pasa a aceptada
        if (accion === 'completar') {
            if (sol.estado !== 'D') {
                await conn.rollback();
                return res.status(409).json({ error: 'Solo se completan las solicitudes con gestión parcial.' });
            }
            if (faltaDocumento) {
                await conn.rollback();
                return res.status(400).json({ error: 'El agente todavía no subió el documento probatorio: la gestión sigue parcial.' });
            }
            const [inas] = await conn.query(
                "SELECT DATE_FORMAT(fechfin, '%Y-%m-%d') AS fin FROM inasist WHERE id_ina = ? AND nleg = ? FOR UPDATE",
                [sol.id_ina, sol.legajo]);
            if (!sol.id_ina || inas.length === 0) {
                await conn.rollback();
                return res.status(404).json({ error: 'No se encontró la inasistencia pendiente de esta solicitud (¿se dio de baja?).' });
            }
            if (inas[0].fin >= hoy) {
                await conn.rollback();
                return res.status(400).json({ error: `La inasistencia sigue en curso hasta el ${enDdMmAaaa(inas[0].fin)}: se completa a partir del día siguiente.` });
            }
            await conn.query("UPDATE inasist SET estado = 'A' WHERE id_ina = ?", [sol.id_ina]);
            await conn.query("UPDATE solicitudes_justificacion SET estado = 'G' WHERE id = ?", [id]);
            await conn.commit();
            return res.status(200).json({ message: 'Gestión completada', estado: 'G', id_ina: sol.id_ina });
        }

        if (sol.estado !== 'A') {
            await conn.rollback();
            const motivoEstado = {
                P: 'todavía no fue aceptada', G: 'ya fue gestionada', R: 'fue rechazada', C: 'fue cancelada',
                D: 'ya tiene gestión parcial (se completa cuando termine la inasistencia y esté el documento)',
            }[sol.estado] ?? `está en estado '${sol.estado}'`;
            return res.status(409).json({ error: `Solo se gestionan solicitudes aceptadas: esta ${motivoEstado}.` });
        }

        if (!sol.codina) {
            await conn.rollback();
            return res.status(400).json({ error: 'La solicitud no tiene motivo: no se puede generar la ausencia.' });
        }
        // Motivos con comprobante (estudio, matrimonio, nacimiento, fallecimiento, congresos, ...) sin el
        // documento: una inasistencia se carga pendiente (gestión parcial); una licencia no se registra
        if (faltaDocumento && sol.tipo !== 'I') {
            await conn.rollback();
            return res.status(400).json({ error: `El motivo "${sol.motivoDesc ?? sol.codina}" requiere el documento probatorio y el agente todavía no lo subió: la licencia no se puede registrar.` });
        }
        if (!FECHA_ISO.test(String(fechaini ?? '')) || !FECHA_ISO.test(String(fechafin ?? '')) || fechafin < fechaini) {
            await conn.rollback();
            return res.status(400).json({ error: 'fechaini y fechafin deben ser fechas válidas (aaaa-mm-dd) y la fecha fin no puede ser anterior al inicio' });
        }
        // Una inasistencia se registra a partir del día siguiente a su inicio (el que pidió el agente y
        // el que se carga ahora). Si todavía no terminó, queda pendiente hasta que termine (gestión
        // parcial). Las licencias no tienen esta restricción.
        if (sol.tipo === 'I') {
            const inicio = sol.fecha_inicio_solicitada && sol.fecha_inicio_solicitada > fechaini ? sol.fecha_inicio_solicitada : fechaini;
            if (inicio >= hoy) {
                await conn.rollback();
                return res.status(400).json({ error: `La inasistencia empieza el ${enDdMmAaaa(inicio)}: se gestiona a partir del día siguiente.` });
            }
        }
        const enCurso = sol.tipo === 'I' && fechafin >= hoy;
        const parcial = sol.tipo === 'I' && (faltaDocumento || enCurso);
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

        // Si ya existe exactamente la misma ausencia (mismo legajo, motivo, fechas y nro. de
        // resolución), no se vuelve a cargar: es la de esta solicitud (p. ej. las que se cargaron
        // con el circuito anterior, que dejaba la solicitud en 'A') y solo se marca como gestionada.
        let generado;
        if (sol.tipo === 'I') {
            const [dupIna] = await conn.query(
                'SELECT id_ina FROM inasist WHERE nleg = ? AND fechcom = ? AND fechfin = ? AND mot = ? AND nres = ?',
                [sol.legajo, fechaini, fechafin, motivo, resolucion]
            );
            const estadoIna = parcial ? 'P' : 'A';
            if (dupIna.length > 0) {
                generado = { id_ina: dupIna[0].id_ina, ya_cargada: true };
                await conn.query('UPDATE inasist SET estado = ? WHERE id_ina = ?', [estadoIna, generado.id_ina]);
            } else {
                const [ins] = await conn.query(
                    `INSERT INTO inasist (nleg, nc, mot, r, fechcom, fechfin, nres, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [sol.legajo, 999, motivo, nr, fechaini, fechafin, resolucion, estadoIna]
                );
                generado = { id_ina: ins.insertId };
            }
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

            // Evita cargar dos veces la misma licencia (mismo legajo, cargo
            // completo -nc+ncg-, motivo, fechas y nro. de resolución) — se
            // incluye nc+ncg porque una persona puede tener más de un cargo a
            // la vez: la misma licencia en cargos distintos no es un duplicado.
            const [dupLic] = await conn.query(
                'SELECT row_id FROM licencia WHERE nleg = ? AND nc = ? AND ncg = ? AND fechcom = ? AND fechfin = ? AND mot = ? AND nres = ?',
                [sol.legajo, nc, ncg, fechaini, fechafin, motivo, resolucion]
            );
            if (dupLic.length > 0) {
                generado = { id_lic: dupLic[0].row_id, ya_cargada: true };
            } else {
                const [ins] = await conn.query(
                    `INSERT INTO licencia (nleg, nc, mot, r, fechcom, fechfin, nres, ncg, observaciones) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [sol.legajo, nc, motivo, nr, fechaini, fechafin, resolucion, ncg, sol.observacion ?? null]
                );
                // igual que la carga manual de licencias: el cargo pasa a figurar con la situación (CG/SG)
                await conn.query('UPDATE cargos SET st = ? WHERE legajo = ? AND nc = ? AND ncg = ?', [nr, sol.legajo, nc, ncg]);
                generado = { id_lic: ins.insertId };
            }
        }

        const estadoNuevo = parcial ? 'D' : 'G';
        await conn.query('UPDATE solicitudes_justificacion SET estado = ?, id_ina = ? WHERE id = ?',
            [estadoNuevo, generado.id_ina ?? null, id]);
        await conn.commit();
        res.status(200).json({
            message: parcial
                ? `Gestión parcial: inasistencia pendiente (${[enCurso && `en curso hasta el ${enDdMmAaaa(fechafin)}`, faltaDocumento && 'falta el documento probatorio'].filter(Boolean).join(' y ')})`
                : 'Solicitud gestionada',
            en_curso: enCurso, falta_documento: faltaDocumento,
            estado: estadoNuevo, ...generado,
        });
    } catch (error) {
        await conn.rollback();
        console.error('Error al gestionar la solicitud de justificación:', error);
        res.status(500).json({ error: 'Error al gestionar la solicitud', detalle: error.message });
    } finally {
        conn.release();
    }
};