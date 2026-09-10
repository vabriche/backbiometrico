import { connect } from '../database.js';
import { filtrarColumnasPermitidas } from '../utils/validaciones.js';

// Columnas editables de diahoraconsu (ver nota sobre `SET ?` en validaciones.js).
const COLUMNAS_HORARIO = [
    'leg', 'id_mat', 'f_inicio', 'f_fin', 'lunes', 'martes', 'miercoles',
    'jueves', 'viernes', 'sabado', 'lugar_c', 'lugar_v', 'carrera',
    'catedra', 'plan', 'sede', 'vigente', 'novedad'
];

export const getMaterias = async (req, res) => {
    const { carrera, plan } = req.params;
    try {
        const db = await connect();
        let rows
        if (carrera === '1' && plan === '1') {
            [rows] = await db.query('SELECT * FROM materias order by car,materia');
        } else {
            [rows] = await db.query('SELECT * FROM materias where car = ? and pl = ?', [carrera, plan]);
        }
        res.send(rows);
    }
    catch (e) {
        console.log(e)
    }
}
//buscar docentes
export const getDocentes = async (req, res) => {
    const { patron } = req.params;
    try {
        const db = await connect();
        let rows
        if (patron == 1) {
            [rows] = await db.query('SELECT legajo, apellido FROM agentes WHERE condicion=1 order by apellido');
        } else {
            [rows] = await db.query('SELECT legajo, apellido FROM agentes WHERE condicion=1 AND apellido like ? order by apellido', [`${patron}%`]);
        }
        res.send(rows)
    } catch (e) {
        console.log(e)
    }

}

////
export const getHconsultaDocente = async (req, res) => {
    const { legajo } = req.params;

    try {
        const db = await connect();
        const strqy = `SELECT hc.id_hora,ma.materia,hc.leg,hc.lunes,hc.martes,hc.miercoles,hc.jueves,hc.viernes,hc.novedad,hc.sede,hc.carrera,hc.lugar_c, lugar_v from diahoraconsu as hc
            INNER JOIN materias ma ON ma.id_materia=hc.id_mat  WHERE hc.vigente='S' AND hc.leg = ?`

        const [rows] = await db.query(strqy, [legajo]);
        res.send(rows)
    } catch (e) {
        console.log(e)
    }
}




//////
export const getHconsultaMateria = async (req, res) => {
    const { sede, carrera, plan, id_mater } = req.params;

    try {
        const db = await connect();
        const strqy = `SELECT hc.id_hora,hc.leg,ag.apellido,hc.lunes,hc.martes,hc.miercoles,hc.jueves,hc.viernes,hc.novedad,hc.sede,hc.carrera,hc.lugar_c, lugar_v from diahoraconsu as hc
            INNER JOIN agentes as ag ON ag.legajo = hc.leg
            WHERE hc.vigente='S' AND hc.id_mat = ? and hc.sede= ? and carrera= ? and plan= ? order by ag.apellido`

        const [rows] = await db.query(strqy, [id_mater, sede, carrera, plan]);
        res.send(rows)
    } catch (e) {
        console.log(e)
    }
}

export const getCatedraIntegrantes = async (req, res) => {
    const { sede, carrera, idmat, tipo } = req.params
    let pl = idmat.substring(0, 1)
    let mat = idmat.substring(1, 4)
    try {
        let sqlstr_1 = 'select cg.inst,cg.ca, cg.legajo,ag.apellido,cg.ppal,cg.nv,plc.cargo, cg.st  from dbasistencia.cargos as cg '
        let sqlstr_i1 = 'inner join dbasistencia.agentes as ag on ag.legajo=cg.legajo '
        let sqlstr_i2 = 'inner join dbasistencia.plantacargos_rrhh as plc on CAST(plc.nv AS INT)=CAST(cg.nv AS INT) and plc.ppal =cg.ppal '
        let strqy = ''
        let params = []
        if (tipo === 'C') {
            if (carrera === '8' || carrera === '2') {
                strqy = `where inst in ('1','2') and car= ? and pl= ? and mat= ? order by cg.inst,cg.nv`
                params = [carrera, pl, mat]
            } else if (carrera === '7') {
                strqy = `where inst='4' and car= ? and pl= ? and mat= ? order by cg.inst,cg.nv`
                params = [carrera, pl, mat]
            } else {
                strqy = `where inst= ? and car= ? and pl= ? and mat= ? order by cg.inst,cg.nv`
                params = [sede, carrera, pl, mat]
            }
        } else if (tipo === 'L') {

            strqy = `where inst= ? and car= ? and pl= ? and mat= ? order by cg.inst, cg.nv`
            params = [sede, carrera, pl, mat]
        }
        let sqlstr = `${sqlstr_1}${sqlstr_i1}${sqlstr_i2}${strqy}`
        const db = await connect()
        const [rows] = await db.query(sqlstr, params)
        res.send(rows)

    } catch (error) {
        console.log(error)
    }
}


//traer materias con carga y vigentes
export const getMateriasVigentes = async (req, res) => {
    const { sede, carrera, plan } = req.params;
    try {
        const db = await connect();

        const strqy = `SELECT distinct hc.id_mat,mat.materia, hc.catedra  FROM diahoraconsu as hc
            INNER JOIN materias as mat on mat.id_materia = hc.id_mat
            WHERE vigente='S' and sede= ? and carrera= ? and plan= ? order by mat.materia`

        const [rows] = await db.query(strqy, [sede, carrera, plan]);

        res.send(rows)

    } catch (e) {
        console.log(e)
    }
}




//nuevo horario de consulta

export const newHorario = async (req, res) => {
  const {
    legdoc, materia, sede, carrera, plan, catedra,
    lunes_c, martes_c, miercoles_c, jueves_c, viernes_c, sabado_c,
    lugar_c, lugar_v, fecha_i
  } = req.body;

  // Validar que todos los campos requeridos están presentes
  if (!legdoc || !materia || !sede || !carrera || !plan || !catedra || !fecha_i) {
    return res.status(400).send({ error: 'Todos los campos son obligatorios' });
  }

  try {
    // Conexión a la base de datos
    const db = await connect();

    // Consulta SQL usando prepared statements para evitar inyección SQL
    const query = `
      INSERT INTO diahoraconsu 
      (leg, id_mat, f_inicio, lunes, martes, miercoles, jueves, viernes, sabado, lugar_c, lugar_v, carrera, catedra, plan, sede) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // Valores a insertar, ordenados correctamente
    const values = [
      legdoc, materia, fecha_i, lunes_c, martes_c, miercoles_c,
      jueves_c, viernes_c, sabado_c, lugar_c, lugar_v, carrera, catedra, plan, sede
    ];

    // Ejecución de la consulta
    const [result] = await db.query(query, values);

    // Verificación de éxito y respuesta al cliente
    if (result.affectedRows > 0) {
      res.status(201).send({ message: 'Horario insertado correctamente' });
    } else {
      res.status(500).send({ error: 'No se pudo insertar el horario' });
    }

  } catch (error) {
    console.error('Error al insertar horario:', error);
    res.status(500).send({ error: 'Error al insertar horario' });
  }
};



///////// baja de horario de consulta
export const bajaHorario = async (req, res) => {
    const { id_hora } = req.params;

    // Validar que se recibió el parámetro 'id_hora'
    if (!id_hora) {
        return res.status(400).json({ error: 'Se requiere un ID de horario válido.' });
    }

    // Validar que el cuerpo de la solicitud no esté vacío
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_HORARIO);
    if (Object.keys(cambios).length === 0) {
        return res.status(400).json({ error: 'No se proporcionaron datos para la actualización.' });
    }

    try {
        const db = await connect();

        // Ejecutar la actualización en la base de datos
        const [result] = await db.query('UPDATE diahoraconsu SET ? WHERE id_hora = ?', [cambios, id_hora]);

        // Verificar si se actualizó algún registro
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Horario no encontrado o no se realizaron cambios.' });
        }

        // Respuesta exitosa
        res.status(200).json({ message: 'Horario dado de baja exitosamente.' });
    } catch (error) {
        console.error('Error al dar de baja el horario:', error);

        // Enviar una respuesta en caso de error
        res.status(500).json({ error: 'Error interno al intentar dar de baja el horario.' });
    }
};


//modificacion de un horario de consulta
export const updateHorario = async (req, res) => {
    const { id_hora } = req.params;

    // Validar si se recibió el ID del horario
    if (!id_hora) {
        return res.status(400).json({ error: 'Se requiere un ID de horario válido.' });
    }

    // Validar que el cuerpo de la solicitud no esté vacío
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_HORARIO);
    if (Object.keys(cambios).length === 0) {
        return res.status(400).json({ error: 'No se proporcionaron datos para la actualización.' });
    }

    try {
        const db = await connect();

        // Ejecutar la consulta SQL para actualizar el horario
        const [result] = await db.query(
            'UPDATE diahoraconsu SET ? WHERE id_hora = ?',
            [cambios, id_hora]
        );

        // Validar si se actualizó alguna fila
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Horario no encontrado o no se realizaron cambios.' });
        }

        // Respuesta exitosa
        res.status(200).json({ message: 'Horario actualizado exitosamente.' });
    } catch (error) {
        console.error('Error al actualizar el horario:', error);

        // Respuesta de error con mensaje más detallado
        res.status(500).json({ error: 'Error interno al intentar actualizar el horario.' });
    }
};

