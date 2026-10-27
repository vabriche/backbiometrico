import { connect } from '../database.js'
import { verifyJWT } from '../config/jw.config.js'

// Licencia anual ordinaria (vacaciones). Capa delgada sobre sql/licencia_anual.sql: las reglas
// de negocio (saldo, reintegro, excepciones, interrupciones) viven en la base, acá solo se
// llama a las funciones, procedimientos y vistas y se traduce el resultado.
// Los errores de negocio (SIGNAL 45000) y de restricciones (4025) vuelven como 422 con el
// mensaje para mostrar tal cual.

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/
const TIPOS_TRAMO = ['principal', 'saldo', 'compensacion']
const MOTIVOS_INTERRUPCION = ['enfermedad', 'trabajo', 'otro']
const REFERENCIAS = ['inasistencia', 'parte_medico', 'asistencia', 'otro']

// Mensajes para las restricciones CHECK de la base
const RESTRICCIONES = {
    chk_interr_enf: 'Para una enfermedad es obligatorio el número de inasistencia o de parte médico',
    chk_tramo_obs: 'El tramo está fuera de norma: la observación es obligatoria',
    chk_escala_dias: 'Los días de la escala deben ser 20, 25, 30, 35, 40 o 45',
    chk_escala_rango: 'En la escala, "hasta" debe ser mayor que "desde"',
    chk_periodo_fechas: 'Las fechas del periodo deben cumplir: inicio habitual < reintegro general < vencimiento',
}

const responderError = (res, mensaje) => (error) => {
    if (error.sqlState === '45000') return res.status(422).json({ error: error.sqlMessage })
    if (error.errno === 4025) {
        const clave = Object.keys(RESTRICCIONES).find((c) => error.sqlMessage?.includes(c))
        return res.status(422).json({ error: clave ? RESTRICCIONES[clave] : 'Los datos no cumplen las reglas de la licencia' })
    }
    if (error.errno === 1062) return res.status(422).json({ error: 'Ya existe un registro con esos datos' })
    console.log(error)
    res.status(500).json({ error: mensaje })
}

// Legajo del usuario logueado, tomado del JWT (el middleware de token no está activo en todas
// las rutas, así que se decodifica acá). Sin token o con token inválido queda null.
const usuarioDe = (req) => {
    const auth = req.headers.authorization ?? ''
    if (!auth.startsWith('Bearer ')) return null
    try {
        return verifyJWT(auth.slice(7)).user?.legajo ?? null
    } catch {
        return null
    }
}

// Corre `fn` con una conexión propia que tiene seteado @app_usuario (lo usan los triggers del
// historial). Con `transaccion` todo va en una transacción.
const conUsuario = async (req, fn, { transaccion = false } = {}) => {
    const conn = await (await connect()).getConnection()
    try {
        await conn.query('SET @app_usuario = ?', [usuarioDe(req)])
        if (transaccion) await conn.beginTransaction()
        const resultado = await fn(conn)
        if (transaccion) await conn.commit()
        return resultado
    } catch (error) {
        if (transaccion) await conn.rollback().catch(() => {})
        throw error
    } finally {
        await conn.query('SET @app_usuario = NULL').catch(() => {})
        conn.release()
    }
}

// Las fechas se devuelven como texto aaaa-mm-dd (o aaaa-mm-dd hh:mm:ss)
const consultar = async (conn, sql, valores) => (await conn.query({ sql, values: valores, dateStrings: true }))[0]

const leer = async (sql, valores) => consultar(await connect(), sql, valores)

// Pasa a 'gozado' los tramos aprobados cuyo reintegro ya pasó. La especificación pide correrlo
// a diario; como el event_scheduler de la base está apagado, se corre antes de cada consulta
// que muestra estados (es idempotente y barato).
const cerrarGozados = async () => {
    const db = await connect()
    await db.query('CALL sp_cerrar_tramos_gozados(@cerrados)')
}

const texto = (valor, max = 255) => {
    const t = String(valor ?? '').trim()
    return t ? t.slice(0, max) : null
}
const fechaONull = (valor) => (ES_FECHA.test(valor ?? '') ? valor : null)
const enteroONull = (valor) => (valor === '' || valor == null || !Number.isInteger(Number(valor)) ? null : Number(valor))

// ---------------------------------------------------------------------
// Personal y derechos
// ---------------------------------------------------------------------

// Personal con su derecho del periodo pedido (o sin derecho si todavía no se generó).
// GET /vacaciones/agentes?periodo=2026
export const getAgentesVacaciones = async (req, res) => {
    const periodo = Number(req.query.periodo) || new Date().getFullYear()
    try {
        await cerrarGozados()
        const filas = await leer(
            `SELECT v.legajo, a.apellido, v.fecha_ingreso, v.reconocimiento_meses, v.activo, v.observacion,
                    s.derecho_id, s.antiguedad_meses, s.dias_corresponden, s.ajuste_motivo, s.dias_aprobados,
                    s.dias_pendientes_autoriz, s.dias_devueltos, s.saldo, s.vencimiento, s.estado_saldo,
                    EXISTS (SELECT 1 FROM reg_licencia_anual_rrhh t
                             WHERE t.derecho_id = s.derecho_id AND t.tipo = 'principal'
                               AND t.estado IN ('pedido','aprobado','gozado')) AS tiene_principal,
                    (SELECT CAST(IFNULL(SUM(o.saldo), 0) AS SIGNED) FROM v_saldo_vacaciones o
                      WHERE o.legajo = v.legajo AND o.periodo < ? AND o.saldo > 0) AS saldo_anterior
               FROM vacaciones_rrhh v
               LEFT JOIN agentes a ON a.legajo = v.legajo
               LEFT JOIN v_saldo_vacaciones s ON s.legajo = v.legajo AND s.periodo = ?
              ORDER BY a.apellido`,
            [periodo, periodo])
        res.send(filas)
    } catch (error) {
        responderError(res, 'No se pudo obtener el listado de licencias anuales')(error)
    }
}

const datosPersonal = (body) => {
    const fecha_ingreso = fechaONull(body?.fecha_ingreso)
    const reconocimiento_meses = enteroONull(body?.reconocimiento_meses ?? 0)
    if (!fecha_ingreso) return { error: 'La fecha de ingreso no es válida' }
    if (reconocimiento_meses === null || reconocimiento_meses < 0 || reconocimiento_meses > 600) {
        return { error: 'El reconocimiento debe ser una cantidad de meses entre 0 y 600' }
    }
    return {
        datos: {
            fecha_ingreso, reconocimiento_meses,
            activo: body?.activo === false || body?.activo === 0 ? 0 : 1,
            observacion: texto(body?.observacion),
        },
    }
}

// Alta de una persona en el personal de vacaciones. body: { legajo, fecha_ingreso, reconocimiento_meses, activo, observacion }
export const crearPersonalVacaciones = async (req, res) => {
    const legajo = enteroONull(req.body?.legajo)
    const { datos, error } = datosPersonal(req.body)
    if (!legajo) return res.status(400).json({ error: 'El legajo no es válido' })
    if (error) return res.status(400).json({ error })
    try {
        const db = await connect()
        const [agente] = await db.query('SELECT 1 FROM agentes WHERE legajo = ?', [legajo])
        if (agente.length === 0) return res.status(404).json({ error: 'No existe un agente con ese legajo' })
        await db.query('INSERT INTO vacaciones_rrhh SET ?', [{ legajo, ...datos }])
        res.status(201).json({ message: 'Agente agregado' })
    } catch (error) {
        responderError(res, 'No se pudo agregar el agente')(error)
    }
}

// Modifica los datos de antigüedad de una persona. No toca derechos ya generados (están congelados).
export const modiPersonalVacaciones = async (req, res) => {
    const { datos, error } = datosPersonal(req.body)
    if (error) return res.status(400).json({ error })
    try {
        const db = await connect()
        const [resu] = await db.query('UPDATE vacaciones_rrhh SET ? WHERE legajo = ?', [datos, req.params.legajo])
        if (resu.affectedRows === 0) return res.status(404).json({ error: 'No se encontró el agente' })
        res.json({ message: 'Datos actualizados' })
    } catch (error) {
        responderError(res, 'No se pudieron modificar los datos')(error)
    }
}

// Reconocimiento leído del texto de la observación ("2 años, 9 meses y 29 días al 30.11.17").
// El texto da una duración que termina en la fecha "al ...": solo se suma la parte anterior
// a la fecha de ingreso, porque lo que se solapa con el ingreso ya está en la antigüedad propia.
// Sin fecha en el texto se toma la duración completa. Los días sueltos se descartan.
// Devuelve null si el texto no tiene años ni meses.
const leerReconocimiento = (observacion, fecha_ingreso) => {
    const t = observacion ?? ''
    const numero = (re) => Number(t.match(re)?.[1] ?? 0)
    const anios = numero(/(\d+) *años?/), meses = numero(/(\d+) *mes/), dias = numero(/(\d+) *d[ií]as?/)
    const total = anios * 12 + meses
    if (!total) return null
    const f = t.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/)
    if (!f) return { meses: total, total, desde: null, hasta: null }
    const anio = f[3].length === 2 ? Number(f[3]) + (Number(f[3]) < 50 ? 2000 : 1900) : Number(f[3])
    const hasta = new Date(Date.UTC(anio, f[2] - 1, Number(f[1])))
    const desde = new Date(Date.UTC(anio - anios, f[2] - 1 - meses, Number(f[1]) - dias))
    const ingreso = new Date(`${fecha_ingreso}T00:00:00Z`)
    const corte = hasta < ingreso ? hasta : ingreso
    const previos = (corte.getUTCFullYear() - desde.getUTCFullYear()) * 12 + corte.getUTCMonth() - desde.getUTCMonth()
        - (corte.getUTCDate() < desde.getUTCDate() ? 1 : 0)
    const iso = (d) => d.toISOString().slice(0, 10)
    return { meses: Math.max(previos, 0), total, desde: iso(desde), hasta: iso(hasta) }
}

// Tabla del personal (vacaciones_rrhh) con la antigüedad al 31/12 del año en curso y el
// reconocimiento que se lee de la observación, para revisarlo y grabarlo.
// GET /vacaciones/personal
export const getPersonalVacaciones = async (req, res) => {
    try {
        const filas = await leer(
            `SELECT v.legajo, a.apellido, v.fecha_ingreso, v.reconocimiento_meses, v.activo, v.observacion,
                    fn_antiguedad_meses(v.legajo, MAKEDATE(YEAR(CURDATE()) + 1, 1) - INTERVAL 1 DAY) AS antiguedad_meses
               FROM vacaciones_rrhh v
               LEFT JOIN agentes a ON a.legajo = v.legajo
              ORDER BY a.apellido`)
        res.send(filas.map((f) => {
            const r = leerReconocimiento(f.observacion, f.fecha_ingreso)
            return {
                ...f, meses_detectados: r?.meses ?? null, meses_texto: r?.total ?? null,
                reconocimiento_desde: r?.desde ?? null, reconocimiento_hasta: r?.hasta ?? null,
            }
        }))
    } catch (error) {
        responderError(res, 'No se pudo obtener el personal')(error)
    }
}

// Graba como reconocimiento la parte anterior al ingreso leída de la observación. Los derechos
// ya generados no cambian (quedan con la antigüedad con que se generaron).
// body: { legajos: [..] }
export const generarReconocimientos = async (req, res) => {
    const legajos = (Array.isArray(req.body?.legajos) ? req.body.legajos : []).map(enteroONull).filter(Boolean)
    if (legajos.length === 0) return res.status(400).json({ error: 'No se indicó ningún agente' })
    try {
        const actualizados = await conUsuario(req, async (conn) => {
            const filas = await consultar(conn,
                'SELECT legajo, fecha_ingreso, observacion FROM vacaciones_rrhh WHERE legajo IN (?) FOR UPDATE', [legajos])
            let cambiados = 0
            for (const f of filas) {
                const r = leerReconocimiento(f.observacion, f.fecha_ingreso)
                if (!r) continue
                const [resu] = await conn.query('UPDATE vacaciones_rrhh SET reconocimiento_meses = ? WHERE legajo = ?', [r.meses, f.legajo])
                cambiados += resu.changedRows
            }
            return cambiados
        }, { transaccion: true })
        res.json({ actualizados })
    } catch (error) {
        responderError(res, 'No se pudieron grabar los reconocimientos')(error)
    }
}

// Corrección manual de los días que corresponden: el motivo es obligatorio y queda en el historial.
// body: { dias_corresponden, ajuste_motivo }
export const ajustarDerecho = async (req, res) => {
    const dias = enteroONull(req.body?.dias_corresponden)
    const motivo = texto(req.body?.ajuste_motivo)
    if (dias === null || dias < 0 || dias > 99) return res.status(400).json({ error: 'La cantidad de días no es válida' })
    if (!motivo) return res.status(400).json({ error: 'Indicá el motivo del ajuste' })
    try {
        await conUsuario(req, async (conn) => {
            const [resu] = await conn.query(
                'UPDATE licencia_anual_derecho SET dias_corresponden = ?, ajuste_motivo = ?, modificado_por = @app_usuario WHERE id = ?',
                [dias, motivo, req.params.id])
            if (resu.affectedRows === 0) throw Object.assign(new Error(), { sqlState: '45000', sqlMessage: 'No se encontró el derecho' })
            const [[{ saldo }]] = await conn.query('SELECT fn_saldo(?) AS saldo', [req.params.id])
            if (saldo < 0) {
                throw Object.assign(new Error(), { sqlState: '45000', sqlMessage: `Con ${dias} días el saldo queda negativo (${saldo})` })
            }
        }, { transaccion: true })
        res.json({ message: 'Derecho ajustado' })
    } catch (error) {
        responderError(res, 'No se pudo ajustar el derecho')(error)
    }
}

// ---------------------------------------------------------------------
// Periodos
// ---------------------------------------------------------------------

export const getPeriodosVacaciones = async (req, res) => {
    try {
        res.send(await leer(
            `SELECT p.*, (SELECT COUNT(*) FROM licencia_anual_derecho d WHERE d.periodo = p.periodo) AS derechos,
                    (SELECT COUNT(*) FROM reg_licencia_anual_rrhh t JOIN licencia_anual_derecho d ON d.id = t.derecho_id
                      WHERE d.periodo = p.periodo) AS tramos
               FROM periodo_vacaciones p ORDER BY p.periodo DESC`))
    } catch (error) {
        responderError(res, 'No se pudieron obtener los periodos')(error)
    }
}

// Genera los derechos del periodo para todo el personal activo (crea el periodo si no existe).
export const generarDerechos = async (req, res) => {
    const periodo = Number(req.params.periodo)
    const anio = new Date().getFullYear()
    if (!Number.isInteger(periodo) || periodo < anio - 1 || periodo > anio + 1) {
        return res.status(400).json({ error: `Solo se pueden generar los periodos ${anio - 1} a ${anio + 1}` })
    }
    try {
        const generados = await conUsuario(req, async (conn) => {
            await conn.query('CALL sp_generar_derechos(?, @generados)', [periodo])
            const [[{ generados }]] = await conn.query('SELECT @generados AS generados')
            return generados
        })
        res.json({ message: 'Derechos generados', generados })
    } catch (error) {
        responderError(res, 'No se pudieron generar los derechos')(error)
    }
}

// Crea el periodo con sus fechas por defecto, sin generar derechos (para revisarlas antes)
export const crearPeriodo = async (req, res) => {
    const periodo = Number(req.params.periodo)
    if (!Number.isInteger(periodo) || periodo < 2000 || periodo > 2100) return res.status(400).json({ error: 'Periodo inválido' })
    try {
        const db = await connect()
        await db.query('CALL sp_crear_periodo(?)', [periodo])
        res.status(201).json({ message: 'Periodo creado' })
    } catch (error) {
        responderError(res, 'No se pudo crear el periodo')(error)
    }
}

// Borra un periodo y sus derechos. Solo si nadie registró tramos de licencia en él: con tramos
// se perdería lo que la gente pidió o gozó.
export const deletePeriodo = async (req, res) => {
    const periodo = Number(req.params.periodo)
    try {
        const borrado = await conUsuario(req, async (conn) => {
            const [[{ tramos }]] = await conn.query(
                `SELECT COUNT(*) AS tramos FROM reg_licencia_anual_rrhh t
                   JOIN licencia_anual_derecho d ON d.id = t.derecho_id WHERE d.periodo = ?`, [periodo])
            if (tramos > 0) {
                throw Object.assign(new Error(), { sqlState: '45000', sqlMessage: `El periodo ${periodo} tiene ${tramos} tramos de licencia registrados: no se puede borrar` })
            }
            // La tabla es versionada: los derechos borrados quedan en su historial
            await conn.query('DELETE FROM licencia_anual_derecho WHERE periodo = ?', [periodo])
            const [resu] = await conn.query('DELETE FROM periodo_vacaciones WHERE periodo = ?', [periodo])
            return resu.affectedRows > 0
        }, { transaccion: true })
        if (!borrado) return res.status(404).json({ error: 'No se encontró el periodo' })
        res.json({ message: 'Periodo borrado' })
    } catch (error) {
        responderError(res, 'No se pudo borrar el periodo')(error)
    }
}

// body: { ventana_desde, reintegro_general, fecha_limite_pedido, vencimiento }
export const modiPeriodo = async (req, res) => {
    const campos = ['ventana_desde', 'reintegro_general', 'fecha_limite_pedido', 'vencimiento']
    const datos = Object.fromEntries(campos.map((c) => [c, fechaONull(req.body?.[c])]))
    if (campos.some((c) => !datos[c])) return res.status(400).json({ error: 'Completá todas las fechas' })
    try {
        const db = await connect()
        const [resu] = await db.query('UPDATE periodo_vacaciones SET ? WHERE periodo = ?', [datos, req.params.periodo])
        if (resu.affectedRows === 0) return res.status(404).json({ error: 'No se encontró el periodo' })
        res.json({ message: 'Periodo actualizado' })
    } catch (error) {
        responderError(res, 'No se pudo modificar el periodo')(error)
    }
}

// ---------------------------------------------------------------------
// Pantalla de pedido, tramos e historia de una persona
// ---------------------------------------------------------------------

// Un renglón por periodo: antigüedad, días, saldo, vencimiento, periodo sugerido y fechas sugeridas.
export const getDatosPedido = async (req, res) => {
    try {
        const db = await connect()
        const [resultados] = await db.query({ sql: 'CALL sp_datos_pedido(?)', values: [req.params.legajo], dateStrings: true })
        res.send(resultados[0])
    } catch (error) {
        responderError(res, 'No se pudieron obtener los datos de la licencia')(error)
    }
}

// App del empleado: exige token y reemplaza cualquier legajo recibido por el del token, así
// los endpoints de RRHH (preparar, registrar, tramos) sirven tal cual sin poder operar sobre otro.
export const soloEmpleado = (req, res, next) => {
    const legajo = usuarioDe(req)
    if (!legajo) return res.status(401).json({ error: 'Token no proporcionado o inválido' })
    req.body = { ...(req.body ?? {}), legajo }
    req.params.legajo = String(legajo)
    next()
}

// Resumen para la app del empleado: el legajo sale del token (cada uno ve solo lo suyo).
// - antigüedad: ingreso, reconocida (otros empleos, solo la anterior al ingreso), propia y total
//   al 31/12 del año en curso, con los días que le daría la escala hoy
// - periodos: por cada periodo con derecho generado, días que le corresponden, saldo y la
//   ventana sugerida (inicio, último día y reintegro) si todavía no pidió la principal
// GET /vacaciones/empleado/resumen   (Authorization: Bearer <token>)
export const getResumenEmpleado = async (req, res) => {
    const legajo = usuarioDe(req)
    if (!legajo) return res.status(401).json({ error: 'Token no proporcionado o inválido' })
    try {
        await cerrarGozados()
        const [persona] = await leer(
            `SELECT v.legajo, a.apellido, v.fecha_ingreso, v.reconocimiento_meses, v.activo, x.corte,
                    TIMESTAMPDIFF(MONTH, v.fecha_ingreso, x.corte) AS antiguedad_propia_meses,
                    fn_antiguedad_meses(v.legajo, x.corte) AS antiguedad_total_meses,
                    fn_dias_por_antiguedad(fn_antiguedad_meses(v.legajo, x.corte)) AS dias_segun_escala
               FROM vacaciones_rrhh v
               JOIN (SELECT MAKEDATE(YEAR(CURDATE()) + 1, 1) - INTERVAL 1 DAY AS corte) x
               LEFT JOIN agentes a ON a.legajo = v.legajo
              WHERE v.legajo = ?`,
            [legajo])
        if (!persona) return res.status(404).json({ error: 'No figurás en el personal de licencia anual' })
        const db = await connect()
        const [resultados] = await db.query({ sql: 'CALL sp_datos_pedido(?)', values: [legajo], dateStrings: true })
        res.json({
            legajo: persona.legajo,
            apellido: persona.apellido,
            activo: !!persona.activo,
            antiguedad: {
                fecha_ingreso: persona.fecha_ingreso,
                al: persona.corte,
                reconocida_meses: persona.reconocimiento_meses,
                propia_meses: Math.max(persona.antiguedad_propia_meses, 0),
                total_meses: persona.antiguedad_total_meses,
                dias_segun_escala: persona.dias_segun_escala,
            },
            periodos: resultados[0].map((p) => ({
                periodo: p.periodo,
                sugerido: !!p.sugerido,
                antiguedad_meses: p.antiguedad_meses,
                dias_corresponden: p.dias_corresponden,
                dias_aprobados: p.dias_aprobados,
                dias_pendientes_autoriz: p.dias_pendientes_autoriz,
                dias_devueltos: p.dias_devueltos,
                saldo: p.saldo,
                estado_saldo: p.estado_saldo,
                vencimiento: p.vencimiento,
                tiene_principal: !!p.tiene_principal,
                fecha_limite_pedido: p.fecha_limite_pedido,
                ventana: { desde: p.ventana_desde, reintegro_general: p.reintegro_general },
                ventana_sugerida: p.inicio_sugerido
                    ? { inicio: p.inicio_sugerido, ultimo_dia: p.ultimo_dia_sugerido, reintegro: p.reintegro_sugerido }
                    : null,
            })),
        })
    } catch (error) {
        responderError(res, 'No se pudo obtener el resumen de la licencia')(error)
    }
}

// Tramos de la persona (todos los periodos) con sus interrupciones.
export const getTramosVacaciones = async (req, res) => {
    try {
        await cerrarGozados()
        const tramos = await leer(
            `SELECT t.id, d.periodo, t.tipo, t.fecha_inicio, t.dias_computados, t.fecha_fin_computo,
                    t.fecha_reintegro, t.dias_corridos, t.estado, t.fuera_de_norma, t.motivos_norma,
                    t.observacion, t.autorizado_por, t.fecha_autoriz, t.motivo_autoriz, t.creado
               FROM reg_licencia_anual_rrhh t
               JOIN licencia_anual_derecho d ON d.id = t.derecho_id
              WHERE d.legajo = ?
              ORDER BY d.periodo DESC, t.fecha_inicio`,
            [req.params.legajo])
        const interrupciones = tramos.length === 0 ? [] : await leer(
            `SELECT id, tramo_id, fecha_desde, fecha_hasta, dias, motivo, tipo_referencia, nro_referencia,
                    estado, observacion, fecha_validacion
               FROM licencia_interrupcion WHERE tramo_id IN (?) ORDER BY fecha_desde`,
            [tramos.map((t) => t.id)])
        res.send(tramos.map((t) => ({ ...t, interrupciones: interrupciones.filter((i) => i.tramo_id === t.id) })))
    } catch (error) {
        responderError(res, 'No se pudieron obtener los tramos')(error)
    }
}

export const getHistoriaVacaciones = async (req, res) => {
    try {
        res.send(await leer(
            `SELECT periodo, fecha_evento, evento, detalle, estado, ref_id
               FROM v_historia_licencias WHERE legajo = ? ORDER BY fecha_evento, periodo`,
            [req.params.legajo]))
    } catch (error) {
        responderError(res, 'No se pudo obtener la historia')(error)
    }
}

// Convierte lo cargado (días, último día o reintegro: uno solo) en días y simula el tramo. No guarda.
// body: { legajo, periodo, tipo, fecha_inicio, dias?, ultimo_dia?, fecha_reintegro? }
// Responde { dias, ultimo_dia, fecha_reintegro, saldo, motivos: [], error } (error de negocio en el cuerpo, con 200).
export const prepararPedido = async (req, res) => {
    const b = req.body ?? {}
    const tipo = TIPOS_TRAMO.includes(b.tipo) ? b.tipo : 'principal'
    try {
        const resultado = await conUsuario(req, async (conn) => {
            await conn.query(
                'CALL sp_preparar_pedido(?, ?, ?, ?, ?, ?, ?, @dias, @ultimo, @reintegro, @saldo, @motivos, @error)',
                [enteroONull(b.legajo), enteroONull(b.periodo), tipo, fechaONull(b.fecha_inicio),
                    enteroONull(b.dias), fechaONull(b.ultimo_dia), fechaONull(b.fecha_reintegro)])
            const [fila] = await consultar(conn,
                'SELECT @dias AS dias, @ultimo AS ultimo_dia, @reintegro AS fecha_reintegro, @saldo AS saldo, @motivos AS motivos, @error AS error')
            return fila
        })
        res.json({ ...resultado, motivos: resultado.motivos ? resultado.motivos.split(',') : [] })
    } catch (error) {
        responderError(res, 'No se pudo calcular el pedido')(error)
    }
}

// Registra un tramo con los días calculados por /preparar.
// body: { legajo, periodo, tipo, fecha_inicio, dias, observacion }
export const registrarTramo = async (req, res) => {
    const b = req.body ?? {}
    if (!TIPOS_TRAMO.includes(b.tipo)) return res.status(400).json({ error: 'Tipo de tramo inválido' })
    try {
        const resultado = await conUsuario(req, async (conn) => {
            await conn.query(
                'CALL sp_registrar_tramo(?, ?, ?, ?, ?, ?, @id, @reintegro, @estado, @motivos)',
                [enteroONull(b.legajo), enteroONull(b.periodo), b.tipo, fechaONull(b.fecha_inicio), enteroONull(b.dias), texto(b.observacion)])
            const [fila] = await consultar(conn, 'SELECT @id AS id, @reintegro AS fecha_reintegro, @estado AS estado, @motivos AS motivos')
            return fila
        }, { transaccion: true })
        res.status(201).json({ ...resultado, motivos: resultado.motivos ? resultado.motivos.split(',') : [] })
    } catch (error) {
        responderError(res, 'No se pudo registrar el tramo')(error)
    }
}

const autorizar = (aprobar) => async (req, res) => {
    if (!usuarioDe(req)) return res.status(401).json({ error: 'Iniciá sesión para autorizar' })
    try {
        await conUsuario(req, (conn) => conn.query('CALL sp_autorizar_tramo(?, ?, ?)', [req.params.id, aprobar ? 1 : 0, texto(req.body?.motivo)]),
            { transaccion: true })
        res.json({ message: aprobar ? 'Tramo aprobado' : 'Tramo rechazado' })
    } catch (error) {
        responderError(res, 'No se pudo procesar la autorización')(error)
    }
}
export const aprobarTramo = autorizar(true)
export const rechazarTramo = autorizar(false)

export const cancelarTramo = async (req, res) => {
    try {
        await conUsuario(req, (conn) => conn.query('CALL sp_cancelar_tramo(?, ?)', [req.params.id, texto(req.body?.motivo)]),
            { transaccion: true })
        res.json({ message: 'Tramo cancelado' })
    } catch (error) {
        responderError(res, 'No se pudo cancelar el tramo')(error)
    }
}

// body: { fecha_desde, fecha_hasta, motivo, tipo_referencia, nro_referencia, observacion }
export const registrarInterrupcion = async (req, res) => {
    const b = req.body ?? {}
    if (!MOTIVOS_INTERRUPCION.includes(b.motivo)) return res.status(400).json({ error: 'Motivo inválido' })
    if (b.tipo_referencia && !REFERENCIAS.includes(b.tipo_referencia)) return res.status(400).json({ error: 'Tipo de referencia inválido' })
    try {
        const resultado = await conUsuario(req, async (conn) => {
            await conn.query(
                'CALL sp_registrar_interrupcion(?, ?, ?, ?, ?, ?, ?, @id, @dias)',
                [req.params.id, fechaONull(b.fecha_desde), fechaONull(b.fecha_hasta), b.motivo,
                    b.tipo_referencia || null, texto(b.nro_referencia, 50), texto(b.observacion)])
            const [fila] = await consultar(conn, 'SELECT @id AS id, @dias AS dias')
            return fila
        }, { transaccion: true })
        res.status(201).json(resultado)
    } catch (error) {
        responderError(res, 'No se pudo registrar la interrupción')(error)
    }
}

// body: { validar: true | false }
export const validarInterrupcion = async (req, res) => {
    if (!usuarioDe(req)) return res.status(401).json({ error: 'Iniciá sesión para validar' })
    const validar = req.body?.validar !== false
    try {
        await conUsuario(req, (conn) => conn.query('CALL sp_validar_interrupcion(?, ?)', [req.params.id, validar ? 1 : 0]),
            { transaccion: true })
        res.json({ message: validar ? 'Interrupción validada' : 'Interrupción rechazada' })
    } catch (error) {
        responderError(res, 'No se pudo procesar la interrupción')(error)
    }
}

// ---------------------------------------------------------------------
// Bandejas
// ---------------------------------------------------------------------

export const getTramosPendientes = async (req, res) => {
    try {
        res.send(await leer(
            `SELECT p.*, a.apellido FROM v_tramos_pendientes p
               LEFT JOIN agentes a ON a.legajo = p.legajo ORDER BY p.creado`))
    } catch (error) {
        responderError(res, 'No se pudieron obtener los tramos pendientes')(error)
    }
}

export const getInterrupcionesPendientes = async (req, res) => {
    try {
        res.send(await leer(
            `SELECT p.*, a.apellido FROM v_interrupciones_pendientes p
               LEFT JOIN agentes a ON a.legajo = p.legajo ORDER BY p.creado`))
    } catch (error) {
        responderError(res, 'No se pudieron obtener las interrupciones pendientes')(error)
    }
}

// ---------------------------------------------------------------------
// Parámetros: feriados y escala
// ---------------------------------------------------------------------

export const getFeriados = async (req, res) => {
    try {
        res.send(await leer('SELECT fecha, descripcion FROM feriados WHERE fecha >= ? ORDER BY fecha',
            [`${new Date().getFullYear() - 1}-01-01`]))
    } catch (error) {
        responderError(res, 'No se pudieron obtener los feriados')(error)
    }
}

// body: { fecha, descripcion }
export const crearFeriado = async (req, res) => {
    const fecha = fechaONull(req.body?.fecha)
    const descripcion = texto(req.body?.descripcion, 100)
    if (!fecha || !descripcion) return res.status(400).json({ error: 'Completá la fecha y la descripción' })
    try {
        const db = await connect()
        await db.query('INSERT INTO feriados (fecha, descripcion) VALUES (?, ?)', [fecha, descripcion])
        res.status(201).json({ message: 'Feriado agregado' })
    } catch (error) {
        responderError(res, 'No se pudo agregar el feriado')(error)
    }
}

export const deleteFeriado = async (req, res) => {
    try {
        const db = await connect()
        const [resu] = await db.query('DELETE FROM feriados WHERE fecha = ?', [req.params.fecha])
        if (resu.affectedRows === 0) return res.status(404).json({ error: 'No se encontró el feriado' })
        res.json({ message: 'Feriado eliminado' })
    } catch (error) {
        responderError(res, 'No se pudo eliminar el feriado')(error)
    }
}

export const getEscala = async (req, res) => {
    try {
        res.send(await leer('SELECT anios_desde, anios_hasta, dias FROM escala_vacaciones ORDER BY anios_desde'))
    } catch (error) {
        responderError(res, 'No se pudo obtener la escala')(error)
    }
}

// Reemplaza la escala completa. body: [{ anios_desde, anios_hasta, dias }]
// Los tramos deben ser contiguos desde 0 (cada "hasta" es el "desde" del siguiente).
export const modiEscala = async (req, res) => {
    const filas = Array.isArray(req.body) ? req.body.map((f) => [enteroONull(f.anios_desde), enteroONull(f.anios_hasta), enteroONull(f.dias)]) : []
    const ordenadas = [...filas].sort((a, b) => a[0] - b[0])
    if (ordenadas.length === 0 || ordenadas.some((f) => f.includes(null))) return res.status(400).json({ error: 'Completá todos los valores de la escala' })
    if (ordenadas[0][0] !== 0 || ordenadas.some((f, i) => i > 0 && f[0] !== ordenadas[i - 1][1])) {
        return res.status(400).json({ error: 'La escala debe empezar en 0 años y cada tramo empezar donde termina el anterior' })
    }
    try {
        await conUsuario(req, async (conn) => {
            await conn.query('DELETE FROM escala_vacaciones')
            await conn.query('INSERT INTO escala_vacaciones (anios_desde, anios_hasta, dias) VALUES ?', [ordenadas])
        }, { transaccion: true })
        res.json({ message: 'Escala actualizada' })
    } catch (error) {
        responderError(res, 'No se pudo actualizar la escala')(error)
    }
}
