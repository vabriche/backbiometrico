import { connect } from '../database.js';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

import { validarFormatoHora, calcularHorasSeguro, sanitizarLegajo, formatearHorasTrabajadas, formatearHorasHHMM } from "../utils/validaciones.js";
import { createToken } from "../config/jw.config.js";
import { getFirebaseAuth } from "../config/firebaseAdmin.config.js";

const BCRYPT_SALT_ROUNDS = 10;
const esHashBcrypt = (hash) => typeof hash === 'string' && /^\$2[aby]\$/.test(hash);

// Verifica la contraseña ingresada contra el hash guardado en `agentes.passuser`.
// Soporta la migración progresiva de MD5 (esquema viejo) a bcrypt: si el hash
// guardado todavía es MD5 y la contraseña coincide, se re-hashea con bcrypt en
// el momento (no se puede convertir un MD5 existente a bcrypt sin la
// contraseña en texto plano, así que la migración es por-login, no masiva).
const verificarYMigrarPassword = async (db, legajo, passwordIngresada, hashGuardado) => {
    if (esHashBcrypt(hashGuardado)) {
        return bcrypt.compare(passwordIngresada, hashGuardado);
    }

    const md5Ingresada = crypto.createHash('md5').update(passwordIngresada).digest('hex');
    const coincide = md5Ingresada === hashGuardado;

    if (coincide) {
        const nuevoHash = await bcrypt.hash(passwordIngresada, BCRYPT_SALT_ROUNDS);
        await db.query('UPDATE agentes SET passuser = ? WHERE legajo = ?', [nuevoHash, legajo]);
    }

    return coincide;
};

//funcion prueba agentes_all
//devuel
export const getAgentes = async (req, res) => {

    try {
        const db = await connect();
        const [rows] = await db.query('SELECT tipodocumento, legajo, apellido, condicion FROM agentes WHERE condicion in (1,2) order by condicion,apellido');
        //console.log(rows)
        if(rows.length>0){
            res.status(200).send(rows)
        }else{
            res.status(404).send({message:'sin registros'})
        }
    } catch (e) {
        res.status(500).send({messaError:'Error de Back'})
        console.log(e)
    }
}

//aplicacion de consultas
export const getAgenteApp = async (req, res) => {
    const nrodocumento = req.params.nrodocumento;

    try {
        const db = await connect();

        // Consulta segura utilizando parámetros para evitar inyección SQL
        let strqry = 'SELECT a.nrodocumento, a.apellido, a.condicion, pr.emailinstitucional, pr.emailpersonal FROM agentes a INNER JOIN perdomicontacto_rrhh pr ON a.legajo = pr.legajo WHERE a.nrodocumento = ?'
        const [rows] = await db.query( strqry,[nrodocumento]);

        // Verificar si se encontró un registro
        if (rows.length > 0) {
            res.status(200).json(rows[0]); // Retornamos el primer (y único) resultado como un objeto JSON
        } else {
            res.status(404).json({ message: 'Agente no encontrado' });
        }

    } catch (error) {
        console.error('Error al obtener el agente:', error); // Log para debugging
        res.status(500).json({ message: 'Error del servidor al obtener el agente' });
    }
};

//funcion agente por legajo

export const getAgente = async (req, res) => {
    const leg = req.params.legajo;

    try {
        const db = await connect();
        const [row] = await db.query('SELECT * FROM agentes WHERE legajo = ?', [leg]);
        res.send(row);
    } catch (e) {
        console.log(e)
        res.status(500).json({ error: 'Error al consultar el agente' })
    }
}

//traer claustro 'condicion'
const traerCondi = async (legajo) => {

    try {
        const db = await connect();
        const [row] = await db.query('SELECT condicion FROM agentes WHERE legajo = ?', [legajo]);
        return (row[0].condicion);
    } catch (e) {
        console.log(e)
    }
}

//
export const getAgenteLogin = async (req, res) => {

    const { legajo, passw } = req.body
    try {
        const strqry = `SELECT legajo, nrodocumento, apellido, condicion, area, encargado_area, passuser FROM agentes WHERE legajo = ?`
        const db = await connect()
        const [rows] = await db.query(strqry, [legajo])

        const agente = rows[0]
        const claveValida = agente ? await verificarYMigrarPassword(db, legajo, passw, agente.passuser) : false

        // Igual que la consulta vieja (WHERE legajo=? AND passuser=MD5(?)): si la
        // clave no es válida, no se revela ningún dato del agente, aunque el
        // legajo exista.
        const respuesta = {
            existe: claveValida ? 1 : 0,
            legajo: claveValida ? agente.legajo : null,
            nrodocumento: claveValida ? agente.nrodocumento : null,
            apellido: claveValida ? agente.apellido : null,
            condicion: claveValida ? agente.condicion : null,
            area: claveValida ? agente.area : null,
            encargado_area: claveValida ? agente.encargado_area : null,
        }

        if (claveValida) {
            respuesta.token = createToken({
                legajo: agente.legajo,
                condicion: agente.condicion,
                encargado_area: agente.encargado_area,
            })
        }

        res.send([respuesta])
    } catch (error) {
        res.send('error')
    }

}
// Login vía Firebase: recibe el idToken emitido por Firebase Auth tras el
// login con email/contraseña en el frontend, lo verifica contra el proyecto
// de Firebase y, si el email corresponde a un agente registrado, emite el
// JWT propio de la app (mismo formato que getAgenteLogin).
export const getAgenteFirebaseLogin = async (req, res) => {

    const { idToken } = req.body
    if (!idToken) {
        return res.status(400).json({ error: 'idToken no proporcionado' })
    }

    try {
        const decoded = await getFirebaseAuth().verifyIdToken(idToken)
        const email = decoded.email
        if (!email) {
            return res.status(401).json({ error: 'El token no tiene un email asociado' })
        }

        const strqry = `SELECT a.legajo, a.nrodocumento, a.apellido, a.condicion, a.area, a.encargado_area
            FROM agentes a INNER JOIN perdomicontacto_rrhh pr ON a.legajo = pr.legajo
            WHERE LOWER(TRIM(pr.emailinstitucional)) = LOWER(TRIM(?)) OR LOWER(TRIM(pr.emailpersonal)) = LOWER(TRIM(?))`
        const db = await connect()
        const [rows] = await db.query(strqry, [email, email])

        if (rows.length === 0) {
            return res.status(403).json({ error: 'usuario no registrado' })
        }

        const agente = rows[0]
        const token = createToken({
            legajo: agente.legajo,
            condicion: agente.condicion,
            encargado_area: agente.encargado_area,
        })

        res.json({ ...agente, token })
    } catch (error) {
        console.error('Error al verificar login con Firebase:', error)
        res.status(401).json({ error: 'Token de Firebase inválido o expirado' })
    }
}

///nuevoAgente


////cambiar password

export const changePassAgente = async (req, res) => {

    const { legajo, passwold, passnew } = req.body
    try {
        const db = await connect()
        const [rows] = await db.query('SELECT passuser FROM agentes WHERE legajo = ?', [legajo])

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Agente no encontrado' })
        }

        const claveActualValida = await verificarYMigrarPassword(db, legajo, passwold, rows[0].passuser)
        if (!claveActualValida) {
            return res.status(401).json({ error: 'La contraseña actual no es correcta' })
        }

        const nuevoHash = await bcrypt.hash(passnew, BCRYPT_SALT_ROUNDS)
        const [resu] = await db.query('UPDATE agentes SET passuser = ? WHERE legajo = ?', [nuevoHash, legajo])
        res.send(resu)
    } catch (e) {
        console.log(e)
        res.status(500).json({ error: 'Error al cambiar la contraseña' })
    }

}

////cambiar password

const existeagente = async (legajo, documento) => {
    const querystr = 'SELECT COUNT(*) AS tot FROM agentes WHERE legajo = ? AND nrodocumento = ?'
    try {
        const db = await connect()
        const [row] = await db.query(querystr, [legajo, documento])
        return row[0].tot
    } catch (error) {
        console.log(error)
    }
}




//Buscar pesona por patron apellido
export const getAgenteName = async (req, res) => {
    const strname = req.params.strpatron;

    let tbusqueda=1
    if(isNaN(strname)){
        tbusqueda=1
    }else{
        tbusqueda=2
    }
    try {
        const db = await connect();
        let rows=null
        if(tbusqueda===1){
            [rows] = await db.query('SELECT legajo,apellido,condicion,area,encargado_area FROM agentes WHERE apellido LIKE ?', [`%${strname}%`])
        }else{
            [rows] = await db.query('SELECT legajo,apellido,condicion,area,encargado_area FROM agentes WHERE legajo=?',[strname])
            
        }
        if (rows.length === 0) {
            return res.status(404).json({ message: 'No se encontraron agentes' });
          }
        res.status(200).send(rows)
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error al buscar agentes' });
    }
}

//buscar personas por area
export const getAgentesArea = async (req, res) => {

    const { area } = req.params
    try {
        const str_sql = 'SELECT area,legajo,apellido FROM agentes WHERE condicion = 0 AND area = ? ORDER BY legajo'
        const db = await connect();
        const [rows] = await db.query(str_sql, [area])
        res.send(rows)
    } catch (e) {
        console.log(e)
    }
}


//Buscar persona/Docente por Apellido por patron apellido
export const getDocenteName = async (req, res) => {
    const strname = req.params.strpatron;
    try {
        const db = await connect();
        const [rows] = await db.query('SELECT legajo,apellido FROM agentes WHERE condicion = 1 AND apellido LIKE ?', [`${strname}%`])
        res.send(rows)
    } catch (e) {
        console.log(e)
    }
}


/////////### INASISTENCIA ENTRE FECHAS

export const getInasistencias_fechas = async (req, res) => {

    const { leg, fecha_i, fecha_f } = req.params;


    const strqry = `SELECT nleg,nc,mot,r,DATE_FORMAT(fechcom,"%d-%m-%Y") as fechai,DATE_FORMAT(fechfin,"%d-%m-%Y") as fechaf,nres
        FROM inasist
        WHERE nleg = ? AND fechcom >= ? AND fechcom <= ?
        ORDER BY fechcom`
    // console.log(strqry)
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [leg, fecha_i, fecha_f])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }

}
///////////////

///--------------------------
/////////////----Inasistencias Reporte--------------

export const getInasistenciasPeriodo = async (req, res) => {

    const { fecha_i, fecha_f } = req.params;

    const strqry = `SELECT ina.nleg,a.apellido,DATE_FORMAT(ina.fechcom,"%d-%m-%Y") as fechai,DATE_FORMAT(ina.fechfin,"%d-%m-%Y") as fechaf,ina.nres,ina.mot,ina.r,a.condicion FROM dbasistencia.inasist ina
     inner join dbasistencia.agentes a on a.legajo=ina.nleg 
     where fechcom BETWEEN CAST(? AS DATE) AND CAST(? AS DATE) order by a.apellido,fechcom,mot`
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [fecha_i, fecha_f])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }


}

//inasistencias total anio 02/04/32
export const getInasistenciasRpEs = async (req, res) => {

    const { legajo, fecha_i, fecha_f } = req.params;

    const strqry = `SELECT ina.mot, sum(ina.fechfin-ina.fechcom + 1) as dias FROM dbasistencia.inasist ina
    inner join dbasistencia.agentes a on a.legajo=ina.nleg  
    where fechcom BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
    and legajo = ? and mot in ('02','04','32')
    group by ina.mot
    order by mot`
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [fecha_i, fecha_f, legajo])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }


}
///------
///____getInasistenciaporlegajo y todo

export const getInasistenciasHistoricas = async (req, res) => {

    const { leg } = req.params;


    const strqry = `SELECT nleg,nc,mot,r,DATE_FORMAT(fechcom,"%d-%m-%Y") as fechai,DATE_FORMAT(fechfin,"%d-%m-%Y") as fechaf,nres
        FROM inasist
        WHERE nleg = ?
        ORDER BY fechcom`
    // console.log(strqry)
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [leg])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }

}


///---------------------Licencias------------------
export const getLicenciasPeriodo = async (req, res) => {

    const { fecha_i, fecha_f } = req.params;

    const strqry = `SELECT lic.nleg,a.apellido,DATE_FORMAT(lic.fechcom,"%d-%m-%Y") as fechai,DATE_FORMAT(lic.fechfin,"%d-%m-%Y") as fechaf,lic.nres,lic.mot,lic.r,a.condicion,lic.nc FROM dbasistencia.licencia lic 
    inner join dbasistencia.agentes a on a.legajo=lic.nleg
    where fechcom BETWEEN CAST(? AS DATE) AND CAST(? AS DATE) order by a.apellido,fechcom,mot
    ` //modificado
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [fecha_i, fecha_f])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }


}

//historico de licencias por agente
/*
export const getLicenciasHistoricas = async (req, res) => {

    const { leg } = req.params;

    let strqry = `SELECT lic.nleg,a.apellido,DATE_FORMAT(lic.fechcom,"%d-%m-%Y") as fechai,DATE_FORMAT(lic.fechfin,"%d-%m-%Y") as fechaf,lic.nres,lic.mot,lic.r,a.condicion,lic.nc FROM dbasistencia.licencia lic 
    inner join dbasistencia.agentes a on a.legajo=lic.nleg
    where lic.nleg=${leg} order by fechcom,mot
    ` 
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [condi, fecha_i, fecha_f])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }


}
*/

//optimizado anterior
export const getLicenciasHistoricas = async (req, res) => {
    const { leg } = req.params;

    const strqry = `
        SELECT 
            lic.nleg, 
            a.apellido, 
            DATE_FORMAT(lic.fechcom, "%d-%m-%Y") as fechai, 
            DATE_FORMAT(lic.fechfin, "%d-%m-%Y") as fechaf, 
            lic.nres, 
            lic.mot, 
            lic.r, 
            a.condicion,
             DATE_FORMAT(lic.fechlim, "%d-%m-%Y") as fechal,  
             lic.nreslim,
             lic.observaciones, 
            lic.nc
        FROM dbasistencia.licencia lic 
        INNER JOIN dbasistencia.agentes a ON a.legajo = lic.nleg 
        WHERE lic.nleg = ? 
        ORDER BY lic.fechcom, lic.mot
    `;

    let db;
    try {
        db = await connect(); // Establecer conexión con la base de datos

        // Usamos un prepared statement para evitar SQL Injection
        const [rows] = await db.query(strqry, [leg]);

        // Si no hay resultados, enviamos un mensaje claro
        if (rows.length === 0) {
            return res.status(404).json({ message: "No se encontraron licencias históricas para el legajo especificado." });
        }

        // Enviar los resultados de la consulta
        res.status(200).json(rows);

    } catch (error) {
        console.error('Error al ejecutar la consulta:', error);
        res.status(500).json({ message: 'Error interno del servidor.' });
    }
};



export const getLicenciaAgenteM = async (req, res) => {
    const { legajo, nc, ncg } = req.params
    const sqlstr = `select l.nleg,l.mot,mt.Motivo  from dbasistencia.licencia l
    inner join dbasistencia.motina mt on mt.codina = CAST (l.mot as Integer)
    where nleg = ? and nc = ? and ncg = ?`
    try {
        const db = await connect()
        const [rows] = await db.query(sqlstr, [legajo, nc, ncg])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }
}

//buscar entre fechas persona

export const getHorario_persona_fechas = async (req, res) => {

    const { condi, leg, fecha_i, fecha_f } = req.params;

    try {
        let cabeza = 'SELECT age.area,age.legajo, age.apellido,DATE_FORMAT(reg.fecha,"%d-%m-%Y") as fecha, reg.Hentrada, reg.Hsalida, reg.cantidadHoras as horasT, nroregistro,virtual FROM '

        let tabla = 'registroasistenciand'
        if (condi === '0') {
            tabla = "registroasistenciand"

        } else if (condi === '1') {

            tabla = "registroasistenciad"
        }
        let cola = '';
        if (fecha_f === '0') {
            cola = ` WHERE reg.legajo = ? AND fecha = ? order by reg.Hentrada`;
        } else {
            cola = ` WHERE reg.legajo = ? AND fecha >= ? AND fecha <= ? ORDER BY reg.fecha,reg.Hentrada`;
        }

        let str_query = `${cabeza} ${tabla} as reg INNER JOIN agentes as age ON age.legajo = reg.legajo ${cola}`
        const db = await connect();
        const params = fecha_f === '0' ? [leg, fecha_i] : [leg, fecha_i, fecha_f];
        const [rows] = await db.query(str_query, params)
        const resultado = rows.map(r => ({ ...r, horasT: formatearHorasTrabajadas(r.horasT, r.Hentrada, r.Hsalida) }))
        res.send(resultado)
    } catch (e) {
        console.log(e)
    }
}
//calcular dias trabajados
export const getDias_Persona_fechas = async (req, res) => {
    const { condi, leg, fecha_i, fecha_f } = req.params;

    let cabeza = ''
    try {


        if (condi === '0') {
            cabeza = 'SELECT count(distinct DATE_FORMAT(fecha,"%d-%m-%Y")) as nrodias FROM registroasistenciand'

        } else if (condi === '1') {

            cabeza = 'SELECT count(distinct DATE_FORMAT(fecha,"%d-%m-%Y")) as nrodias FROM registroasistenciand'
        }
        let cola = '';
        if (fecha_f === '0') {
            cola = ` WHERE legajo = ? AND fecha = ?`;
        } else {
            cola = ` WHERE legajo = ? AND fecha >= ? AND fecha <= ?`;
        }

        let str_query = `${cabeza} ${cola}`
        const db = await connect();
        const params = fecha_f === '0' ? [leg, fecha_i] : [leg, fecha_i, fecha_f];
        const [rows] = await db.query(str_query, params)
        res.send(rows)
    } catch (e) {
        console.log(e)
    }
}

//buscar entre fechas por claustro

export const getHorarioClaustroFechas = async (req, res) => {

    const { condi, fecha_i, fecha_f } = req.params


    try {
        const cabeza = 'SELECT age.area,age.legajo, age.apellido,DATE_FORMAT(reg.fecha,"%d-%m-%Y") as fecha, reg.Hentrada, reg.Hsalida,reg.cantidadHoras as horasT, reg.nroregistro FROM '
        const tabla = condi === '1' ? 'registroasistenciad' : 'registroasistenciand'
        const cola = fecha_f === '0'
            ? ' WHERE fecha = ? ORDER BY age.apellido,reg.fecha,reg.Hentrada'
            : ' WHERE fecha >= ? AND fecha <= ? ORDER BY age.apellido,reg.fecha,reg.Hentrada'
        const str_query = `${cabeza} ${tabla} as reg INNER JOIN agentes as age ON age.legajo = reg.legajo ${cola}`
        const params = fecha_f === '0' ? [fecha_i] : [fecha_i, fecha_f];
        const db = await connect();
        const [rows] = await db.query(str_query, params)
        const resultado = rows.map(r => ({ ...r, horasT: formatearHorasTrabajadas(r.horasT, r.Hentrada, r.Hsalida) }))
        res.send(resultado)
    } catch (e) {
        console.log(e)
    }

}


//cantidad de horas
export const getHorasT_Persona_fechas = async (req, res) => {

    const { condi, leg, fecha_i, fecha_f } = req.params;

    let cabeza = ''

    try {

        if (condi === '0') {
            cabeza = "SELECT sum(cantidadhoras) as horasT FROM registroasistenciand"

        } else if (condi === '1') {

            cabeza = "SELECT sum(cantidadhoras) as horasT FROM registroasistenciand"
        }
        let cola = '';
        if (fecha_f === '0') {
            cola = ` WHERE legajo = ? AND fecha = ?`;
        } else {
            cola = ` WHERE legajo = ? AND fecha >= ? AND fecha <= ?`;
        }

        let str_query = `${cabeza} ${cola}`
        const db = await connect();
        const params = fecha_f === '0' ? [leg, fecha_i] : [leg, fecha_i, fecha_f];
        const [rows] = await db.query(str_query, params)
        const resultado = rows.map(r => ({ ...r, horasT: formatearHorasHHMM(r.horasT) }))
        res.send(resultado)
    } catch (error) {
        console.log(error)
    }
}




//buscar entre fechas por area de trabajo
export const getHorasAreadeTrabajo = async (req, res) => {

    const { area, fecha_i, fecha_f } = req.params

    try {
        let cabeza = 'SELECT age.area,age.legajo, age.apellido,DATE_FORMAT(reg.fecha,"%d-%m-%Y") as fecha, reg.Hentrada, reg.Hsalida,reg.cantidadHoras as horasT,reg.virtual, reg.nroregistro FROM '

        let tabla = ''
        if (area === 'Docentes') {
            tabla = 'registroasistenciad'
        } else {

            tabla = 'registroasistenciand'
        }
        /*
        if(condi === '0'){
            tabla="registroasistenciand"
    
        }else if(condi === '1'){
    
            tabla="registroasistenciad"
        }
        */
        let cola = '';
        if (fecha_f === '0') {
            cola = ` WHERE fecha = ? order by age.area,age.legajo,reg.fecha,reg.Hentrada`;
        } else {
            cola = ` WHERE age.area = ? AND fecha >= ? AND fecha <= ? order by age.area,age.apellido,reg.fecha,reg.Hentrada`;
        }


        let str_query = `${cabeza} ${tabla} as reg INNER JOIN agentes as age ON age.legajo = reg.legajo ${cola}`
        const db = await connect();
        const params = fecha_f === '0' ? [fecha_i] : [area, fecha_i, fecha_f];
        const [rows] = await db.query(str_query, params)
        const resultado = rows.map(r => ({ ...r, horasT: formatearHorasTrabajadas(r.horasT, r.Hentrada, r.Hsalida) }))
        res.send(resultado)
    } catch (e) {
        console.log(e)
    }

}

//arreglar asistencia

//calcular horas trabajadas
const calcularhoras = (he, hs) => {

    let thp = 0
    let tmp = 0
    let totalc = 0
    let mine = parseInt(he.substring(3, 5))
    let hore = parseInt(he.substring(0, 2))

    let mins = parseInt(hs.substring(3, 5))
    let hors = parseInt(hs.substring(0, 2))

    if (mine > mins) {
        thp = hors - hore - 1
        tmp = mins + 60 - mine
    } else {
        thp = hors - hore
        tmp = mins - mine
    }
    console.log(hore, mine, hors, mins, thp, tmp)
    totalc = thp + tmp / 60

    return totalc



}


// controllers/asistencia.js

export const updateAsistencia = async (req, res) => {
  const { leg, nror, he, hs } = req.params;

  // 1. Validar y sanitizar IDs numéricos (previene SQL injection)
  const legajo = sanitizarLegajo(leg);
  const nroRegistro = sanitizarLegajo(nror);

  if (!legajo || !nroRegistro) {
    return res.status(400).json({ error: "Legajo o número de registro inválido." });
  }

  // 2. Validar formato HH:MM
  if (!validarFormatoHora(he) || !validarFormatoHora(hs)) {
    return res.status(400).json({ error: "Formato de hora inválido. Usar HH:MM." });
  }

  // 3. Verificar que HS > HE
  const ht = calcularHorasSeguro(he, hs);

  if (ht <= 0) {
    return res.status(400).json({ error: "La hora de salida debe ser posterior a la hora de entrada." });
  }

  // 4. Limitar horas máximas por jornada
  if (ht > 12) {
    return res.status(400).json({ error: "La jornada no puede superar las 24 horas." });
  }

  // 5. Determinar tabla según condición
  let condi;
  try {
    condi = await traerCondi(legajo);
  } catch (error) {
    console.error("Error al obtener condición:", error);
    return res.status(500).json({ error: "Error interno al consultar condición del legajo." });
  }

  const tabla = condi === "2" ? "registroasistenciand" : "registroasistenciad";

  // 6. Usar parámetros preparados (previene SQL injection de forma robusta)
  const strqUpdate = `
    UPDATE ${tabla}
    SET Hentrada = ?, Hsalida = ?, cantidadHoras = ?
    WHERE nroregistro = ? AND legajo = ?
  `;

  try {
    const db = await connect();
    const resu = await db.query(strqUpdate, [he, hs, ht, nroRegistro, legajo]);
    
    if (resu.affectedRows === 0) {
      return res.status(404).json({ error: "No se encontró el registro para actualizar." });
    }

    res.json({ success: true, horasTrabajadas: ht });
  } catch (error) {
    console.error("Error al actualizar asistencia:", error);
    res.status(500).json({ error: "Error interno al actualizar el registro." });
  }
};

//
//
//estadisticas de promedio por claustro *promedio en funcion de nro de marcas
export const getEstadistasHorasND = async (req, res) => {

    const { condi, fecha_i, fecha_f } = req.params
    let tabla = ''
    try {

        if (condi == 1) {
            tabla = 'dbasistencia.registroasistenciad'
        } else {
            tabla = 'dbasistencia.registroasistenciand'
        }
        const db = await connect()

        let strqry = `SELECT age.legajo,age.apellido,age.condicion,age.area,  count(asis.cantidadHoras) as dias ,round(sum(asis.cantidadHoras),2) as total,round(avg(asis.cantidadHoras),2) as media  FROM dbasistencia.agentes as age  
        INNER JOIN ${tabla} as asis ON asis.legajo = age.legajo
        WHERE age.condicion = ? AND asis.fecha >= ? AND asis.fecha <= ?
        GROUP BY age.legajo,age.apellido
        ORDER BY area,dias,media DESC`


        const [rows] = await db.query(strqry, [condi, fecha_i, fecha_f])
        res.send(rows)
    } catch (e) {
        console.log(e)
    }
}




export const getEstadistasHorasD = async (req, res) => {
    const { condi, fecha_i, fecha_f } = req.params
    try {
        let strqry = `SELECT age.legajo,age.apellido,age.condicion,age.area,  count(asis.cantidadHoras) as dias ,round(sum(asis.cantidadHoras),2) as total, round(avg(asis.cantidadHoras),2) as media  FROM dbasistencia.agentes as age  
        INNER JOIN dbasistencia.registroasistenciad as asis ON asis.legajo = age.legajo
        WHERE age.condicion = ? AND asis.fecha >= ? AND asis.fecha <= ?
        GROUP BY age.legajo,age.apellido
        ORDER BY media DESC`

        const db = await connect()
        const [rows] = await db.query(strqry)
        res.send(rows)
    } catch (e) {
        console.log(e)
    }
}

// promedios ? mal
// nuevo proceso del mismo
//nuevo proceso de promedios horas y dias marcados
// suma de personas por claustro

//cantidad de horas en un dia docentes o no docentes
const cantihorasclaustrodia = async (fecha, claustro) => {
    let tabla = ''
    tabla = claustro === '1' ? 'dbasistencia.registroasistenciad' : 'dbasistencia.registroasistenciand'
    try {
        const sqlstr = `select sum(cantidadHoras) as tot from ${tabla}
        where fecha = ?`
        const db = await connect()
        const [rows] = await db.query(sqlstr, [fecha])
        //console.log()
        return rows[0].tot

    } catch (error) {
        console.log(error)
    }

}

//cantidad de personas que marcaron en el dia

const cantidadpersonasmarca = async (fecha, claustro) => {
    let tabla = ''
    tabla = claustro === '1' ? 'dbasistencia.registroasistenciad' : 'dbasistencia.registroasistenciand'
    try {
        const sqlstr = `select distinct legajo from ${tabla}
        where fecha = ?`
        const db = await connect()
        const [rows] = await db.query(sqlstr, [fecha])
        return rows.length

    } catch (error) {
        console.log(error)
    }

}



export const traerDatosPromedia = async (req, res) => {

    const { fecha, claustro } = req.params
    let horasdoc = 0.0
    let horasnodoc = 0.0
    let registrosdoc = 0
    let registrosnodoc = 0

    try {
        if (claustro === '1') {
            horasdoc = await cantihorasclaustrodia(fecha, claustro)
            registrosdoc = await cantidadpersonasmarca(fecha, claustro)
            res.send({ 'horas': horasdoc, 'nroreg': registrosdoc })
        } else if (claustro === '2') {

            horasnodoc = await cantihorasclaustrodia(fecha, claustro)
            registrosnodoc = await cantidadpersonasmarca(fecha, claustro)
            res.send({ 'horas': horasnodoc, 'nroreg': registrosnodoc })
        }
        //console.log(horasdoc, horasnodoc, registrosdoc, registrosnodoc)

    } catch (error) {
        console.log(error)
    }
}

//////traer datos dia a dia

///nuevo registro

// controllers/asistencia.js

export const newRegistroasistencia = async (req, res) => {
    const { condi, legajo, fecha, hora } = req.body;
  
    // 1. Validar condi (solo valores permitidos)
    if (!validarCondi(condi)) {
      return res.status(400).json({ error: "Condición inválida. Valores permitidos: 1, 2." });
    }
  
    // 2. Sanitizar legajo
    const legajoSanitizado = sanitizarLegajo(legajo);
    if (!legajoSanitizado) {
      return res.status(400).json({ error: "Legajo inválido." });
    }
  
    // 3. Validar fecha
    if (!validarFecha(fecha)) {
      return res.status(400).json({ error: "Fecha inválida. Usar formato YYYY-MM-DD." });
    }
  
    // 4. Validar formato de hora
    if (!validarFormatoHora(hora)) {
      return res.status(400).json({ error: "Formato de hora inválido. Usar HH:MM." });
    }
  
    // 5. Determinar tabla (valor controlado, sin input del usuario)
    const tabla = condi === "1" ? "registroasistenciad" : "registroasistenciand";
  
    // 6. Verificar que no exista ya un registro para ese legajo y fecha
    const sqlCheck = `
      SELECT COUNT(*) AS total FROM ${tabla}
      WHERE legajo = ? AND fecha = ?
    `;
  
    try {
      const db = await connect();
  
      const [check] = await db.query(sqlCheck, [legajoSanitizado, fecha]);
      if (check.total > 0) {
        return res.status(409).json({ error: "Ya existe un registro para este legajo en la fecha indicada." });
      }
  
      // 7. Insert con parámetros preparados
      const sqlInsert = `
        INSERT INTO ${tabla} (legajo, fecha, Hentrada, virtual)
        VALUES (?, ?, ?, 'V')
      `;
  
      const resu = await db.query(sqlInsert, [legajoSanitizado, fecha, hora]);
  
      res.status(201).json({ success: true, insertId: resu.insertId });
  
    } catch (error) {
      console.error("Error al crear registro de asistencia:", error);
      res.status(500).json({ error: "Error interno al crear el registro." });
    }
  };

//registrar salida virtual   

export const registrarSalida = async (req, res) => {
    const { condi, legajo, nroregistro } = req.params;
    const { hora, horastr } = req.body;
  
    // 1. Validar condi
    if (!validarCondi(condi)) {
      return res.status(400).json({ error: "Condición inválida. Valores permitidos: 1, 2." });
    }
  
    // 2. Sanitizar IDs numéricos
    const legajoSanitizado = sanitizarLegajo(legajo);
    const nroRegistroSanitizado = sanitizarLegajo(nroregistro);
  
    if (!legajoSanitizado || !nroRegistroSanitizado) {
      return res.status(400).json({ error: "Legajo o número de registro inválido." });
    }
  
    // 3. Validar hora de salida
    if (!validarFormatoHora(hora)) {
      return res.status(400).json({ error: "Formato de hora inválido. Usar HH:MM." });
    }
  
    // 4. Validar horastr (cantidad de horas trabajadas, número positivo <= 12)
    const horasTrabajadas = parseFloat(horastr);
    if (isNaN(horasTrabajadas) || horasTrabajadas <= 0 || horasTrabajadas > 12) {
      return res.status(400).json({ error: "Cantidad de horas trabajadas inválida." });
    }
  
    // 5. Determinar tabla
    const tabla = condi === "1" ? "registroasistenciad" : "registroasistenciand";
  
    // 6. Verificar que el registro existe y que no tenga ya una salida registrada
    const sqlCheck = `
      SELECT Hsalida FROM ${tabla}
      WHERE nroregistro = ? AND legajo = ?
    `;
  
    try {
      const db = await connect();
  
      const [registro] = await db.query(sqlCheck, [nroRegistroSanitizado, legajoSanitizado]);
  
      if (!registro) {
        return res.status(404).json({ error: "No se encontró el registro de asistencia." });
      }
  
      if (registro.Hsalida !== null && registro.Hsalida !== "") {
        return res.status(409).json({ error: "Ya existe una salida registrada para este registro." });
      }
  
      // 7. Update con parámetros preparados
      const sqlUpdate = `
        UPDATE ${tabla}
        SET Hsalida = ?, cantidadHoras = ?, virtual = 'V'
        WHERE nroregistro = ? AND legajo = ?
      `;
  
      const resu = await db.query(sqlUpdate, [
        hora,
        horasTrabajadas,
        nroRegistroSanitizado,
        legajoSanitizado,
      ]);
  
      if (resu.affectedRows === 0) {
        return res.status(404).json({ error: "No se pudo actualizar el registro." });
      }
  
      res.json({ success: true, horasTrabajadas });
  
    } catch (error) {
      console.error("Error al registrar salida:", error);
      res.status(500).json({ error: "Error interno al registrar la salida." });
    }
  };

// acreditacion de horas
export const acreditarHorarioVirtual = async (req, res) => {


    const { legajo, nroregistro } = req.params
    let condi = await traerCondi(legajo)

    let tabla = ''
    if (condi === 1) {
        tabla = 'registroasistenciad'
    } else {
        tabla = 'registroasistenciand'
    }

    //let horastr = await calcularHorasTrabajadas(condi,legajo,fecha,hora)
    const sqlu = `UPDATE ${tabla} SET virtual = 'A'
        WHERE nroregistro = ? AND legajo = ?`
    try {
        const db = await connect()
        const resu = await db.query(sqlu, [nroregistro, legajo])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }

}




//listado de Inasistencias 


//buscar Asistentes fecha

const setPresentes = (datos) => {

    try {

    } catch (error) {
        console.log(error)
    }
}


const setAusenteAgente = async () => {

    let sqlu = "update dbasistencia.agentes set asistencia='A' where condicion=2 and not asistencia in ('L','O','V')"

    try {
        const db = await connect()
        const resu = await db.query(sqlu)

    } catch (error) {
        console.log(error)
    }
}
const buscarAsistenteFecha = async (fecha) => {

    const sqlstr = `update dbasistencia.agentes set asistencia='P' where condicion=2 and legajo in (
        select DISTINCT age.legajo from dbasistencia.agentes age 
        inner join dbasistencia.registroasistenciand ran on ran.legajo=age.legajo
        where age.condicion=2 and asistencia='A' and fecha = ?)
    `

    try {

        const db = await connect()
        const resu = await db.query(sqlstr, [fecha])

    } catch (error) {
        console.log(error)
    }
}

export const buscarAusentes = async (req, res) => {
    const { fecha } = req.params

    let sqlstr = "SELECT legajo,apellido,area,asistencia FROM dbasistencia.agentes WHERE condicion='2' AND asistencia in ('A','L') order by apellido  "

    try {
        await setAusenteAgente()
        await buscarAsistenteFecha(fecha)
        const db = await connect()
        const [resu] = await db.query(sqlstr)
        res.send(resu)

    } catch (error) {
        console.log(error)
    }
}


//datos asistencia por tipo online
//

//cantidad de agentes docentes presencial
const cantiMarcaDocPre = async (fecha) => {
    const sqlstr = `select distinct legajo from dbasistencia.registroasistenciad
    where fecha = ? and virtual='P'`
    try {
        const db = await connect()
        const [resu] = await db.query(sqlstr, [fecha])
        //console.log(resu.length)
        return resu.length
    } catch (error) {
        console.log(error)
    }
}

//cantidad de agentes docentes virtuales
const cantiMarcaDocVirt = async (fecha) => {
    const sqlstr = `select distinct legajo from dbasistencia.registroasistenciad
    where fecha = ? and virtual='V'`
    try {
        const db = await connect()
        const [resu] = await db.query(sqlstr, [fecha])
        return resu.length
    } catch (error) {
        console.log(error)
    }
}

//solo aquellos presentes presenciales 
const cantiMarcaDocPPresentes = async (fecha) => {
    const sqlstr = `select distinct legajo from dbasistencia.registroasistenciad
    where fecha = ? and Hsalida='X' and virtual='P'`
    try {
        const db = await connect()
        const [resu] = await db.query(sqlstr, [fecha])
        return resu.length
    } catch (error) {
        console.log(error)
    }
}

//solo aquellos docentes presentes virtuales
const cantiMarcaDocVPresentes = async (fecha) => {
    const sqlstr = `select distinct legajo from dbasistencia.registroasistenciad
    where fecha = ? and Hsalida='X' and virtual='V'`
    try {
        const db = await connect()
        const [resu] = await db.query(sqlstr, [fecha])
        return resu.length
    } catch (error) {
        console.log(error)
    }
}




//asistencia presencial no docentes
const cantiMarcaNoDocPre = async (fecha) => {
    const sqlstr = `select distinct legajo from dbasistencia.registroasistenciand
    where fecha = ? and virtual='P'`
    try {
        const db = await connect()
        const [resu] = await db.query(sqlstr, [fecha])
        return resu.length
    } catch (error) {
        console.log(error)
    }
}

//asistencia virtual no docentes
const cantiMarcaNoDocVirt = async (fecha) => {
    const sqlstr = `select distinct legajo from dbasistencia.registroasistenciand
    where fecha = ? and virtual='V'`
    try {
        const db = await connect()
        const [resu] = await db.query(sqlstr, [fecha])
        return resu.length
    } catch (error) {
        console.log(error)
    }
}


//no docentes presentes presencial
const cantiMarcaNoDocPPresentes = async (fecha) => {
    const sqlstr = `select distinct legajo from dbasistencia.registroasistenciand
    where fecha = ? and Hsalida='X' and virtual='P'`
    try {
        const db = await connect()
        const [resu] = await db.query(sqlstr, [fecha])
        //console.log(resu.rows)
        return resu.length
    } catch (error) {
        console.log(error)
    }
}

//no docentes presentes viruales
const cantiMarcaNoDocVPresentes = async (fecha) => {
    const sqlstr = `select distinct legajo from dbasistencia.registroasistenciand
    where fecha = ? and Hsalida='X' and virtual='V'`
    try {
        const db = await connect()
        const [resu] = await db.query(sqlstr, [fecha])
        return resu.length
    } catch (error) {
        console.log(error)
    }
}



//recolector de info de registro doc, no doc, presencial y virtual
export const getAsistenciadia = async (req, res) => {

    const { fecha } = req.params


    let datosAsistencia = {

        docmarcadosP: 0,
        docmarcadosV: 0,
        docmarcadosPS: 0,
        docmarcadosVS: 0,
        NdocmarcadosP: 0,
        NdocmarcadosV: 0,
        NdocmarcadosPS: 0,
        NdocmarcadosVS: 0,
    }

    try {

        datosAsistencia = {
            docmarcadosP: await cantiMarcaDocPre(fecha),
            docmarcadosV: await cantiMarcaDocVirt(fecha),
            docmarcadosPS: await cantiMarcaDocPPresentes(fecha),
            docmarcadosVS: await cantiMarcaDocVPresentes(fecha),

            NdocmarcadosP: await cantiMarcaNoDocPre(fecha),
            NdocmarcadosV: await cantiMarcaNoDocVirt(fecha),
            NdocmarcadosPS: await cantiMarcaNoDocPPresentes(fecha),
            NdocmarcadosVS: await cantiMarcaNoDocVPresentes(fecha),
        }
        console.log(datosAsistencia)
        res.send(datosAsistencia)

    } catch (error) {
        console.log(error)
    }
}



// Resetea la password al nro. de documento del agente (flujo "olvidé mi
// contraseña"), valida legajo+documento contra la BD, y devuelve el mismo
// formato que getAgenteLogin (incluido el JWT) para poder loguear al agente
// directo tras el reset.
export const resetPassAgente = async (req, res) => {

    const { legajo, documento } = req.body
    try {
        const verdao = await existeagente(legajo, documento)
        if (verdao > 0) {
            const db = await connect()
            const nuevoHash = await bcrypt.hash(String(documento), BCRYPT_SALT_ROUNDS)
            await db.query('UPDATE agentes SET passuser = ? WHERE legajo = ?', [nuevoHash, legajo])

            const [rows] = await db.query(
                'SELECT legajo, nrodocumento, apellido, condicion, area, encargado_area FROM agentes WHERE legajo = ?',
                [legajo]
            )
            const agente = rows[0]
            const token = createToken({
                legajo: agente.legajo,
                condicion: agente.condicion,
                encargado_area: agente.encargado_area,
            })

            res.send({
                existe: 1,
                legajo: agente.legajo,
                nrodocumento: agente.nrodocumento,
                apellido: agente.apellido,
                condicion: agente.condicion,
                area: agente.area,
                encargado_area: agente.encargado_area,
                token,
            })
        } else {
            res.send('N')
        }
    } catch (e) {
        console.log(e)
        res.status(500).send('N')
    }

}


export const traerControlAsistenciaPersonal = async (req, res) => {
  const db = await connect();
  try {
    const fechaConsulta = req.query.fecha;
    if (!fechaConsulta) {
      return res.status(400).json({ error: "La fecha de consulta es requerida" });
    }

    const fechaLocal = fechaConsulta.replace(/-/g, "/");
    const date = new Date(fechaLocal);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ error: "Fecha inválida" });
    }

    // 1) Personal de apoyo (condicion = '2')
    const sqlAgentes = `
      SELECT legajo, apellido
      FROM agentes
      WHERE condicion = '2'
      ORDER BY apellido
    `;
    const [agentes] = await db.query(sqlAgentes);

    if (agentes.length === 0) {
      return res.json([]);
    }

    const legajos = agentes.map(a => a.legajo);

    // 2) Registros de asistencia de esos legajos para la fecha puntual
    // (puede haber más de un registro por legajo en el día, ej. entrada/salida
    // a la mañana y otra entrada/salida a la tarde)
    const sqlAsistencia = `
      SELECT legajo, Hentrada, Hsalida, cantidadHoras
      FROM registroasistenciand
      WHERE fecha = ? AND legajo IN (?)
      ORDER BY legajo, Hentrada
    `;
    const [asistencias] = await db.query(sqlAsistencia, [fechaConsulta, legajos]);

    const asistenciasPorLegajo = {};
    asistencias.forEach(r => {
      if (!asistenciasPorLegajo[r.legajo]) {
        asistenciasPorLegajo[r.legajo] = [];
      }
      asistenciasPorLegajo[r.legajo].push(r);
    });

    // 3) Inasistencias que cubran esa fecha, para esos legajos
    const sqlInasist = `
      SELECT nleg, mot, estado, fechcom, fechfin
      FROM inasist
      WHERE nleg IN (?) AND fechcom <= ? AND (fechfin IS NULL OR fechfin >= ?)
    `;
    const [inasistencias] = await db.query(sqlInasist, [legajos, fechaConsulta, fechaConsulta]);

    const inasistPorLegajo = {};
    inasistencias.forEach(i => {
      // Si hubiera más de una inasistencia solapada, nos quedamos con la primera encontrada
      if (!inasistPorLegajo[i.nleg]) {
        inasistPorLegajo[i.nleg] = i;
      }
    });

    const esVacio = (valor) => !valor || valor === 'X';

    const resultados = agentes.flatMap(agente => {
      const registros = asistenciasPorLegajo[agente.legajo] || [];

      if (registros.length === 0) {
        // No hay ningún registro de asistencia ese día -> se busca inasistencia
        const ina = inasistPorLegajo[agente.legajo];

        let mot = '';
        let estado = '';
        let observacion = '';

        if (ina) {
          mot = ina.mot || '';
          if (ina.estado === 'P') {
            // Pendiente: se aclara explícitamente
            estado = 'P';
            observacion = 'registra inasistencia pendiente';
          } else {
            // estado vacío o 'A' (aceptado): ambos se tratan igual
            estado = '';
            observacion = 'registra inasistencia justificada';
          }
        } else {
          observacion = 'falta sin justificacion';
        }

        return [{
          legajo: agente.legajo,
          apellido: agente.apellido,
          Hentrada: 'X',
          Hsalida: 'X',
          cantidadHoras: 'FR',
          mot,
          estado,
          observacion
        }];
      }

      // Uno o más registros ese día (ej. turno mañana y turno tarde): una fila por cada uno
      return registros.map(registro => {
        const tieneEntrada = !esVacio(registro.Hentrada);
        const tieneSalida = !esVacio(registro.Hsalida);

        return {
          legajo: agente.legajo,
          apellido: agente.apellido,
          Hentrada: registro.Hentrada,
          Hsalida: registro.Hsalida,
          cantidadHoras: formatearHorasTrabajadas(registro.cantidadHoras, registro.Hentrada, registro.Hsalida),
          mot: '',
          estado: '',
          observacion: (tieneEntrada && tieneSalida) ? '' : 'se ha omitido un registro'
        };
      });
    });

    res.json(resultados);
  } catch (err) {
    console.error("Error en la consulta:", err);
    res.status(500).json({ error: "Error en la consulta", details: err.message });
  }
};