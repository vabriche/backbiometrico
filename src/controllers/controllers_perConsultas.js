
import { connect } from '../database.js';


export const getcargosVigFicha = async (req, res) => {
    const {legajo} = req.parms
    
    try {

        let sqlStr=` SELECT inst,ca,c.es,concat(c.ppal,c.nv),pr.cargo,concat(c.pl,c.mat) as idmat, m.materia,DATE_FORMAT(fechalt,"%d-%m-%Y") as fechaAlta ,nresa,
        DATE_FORMAT(fechbaj,"%d-%m-%Y") as fechaBaja,nresb,mb,st FROM cargos c 
        inner join materias m on cast(concat(c.pl,c.mat) as integer)= m.id_materia
        inner join plantacargos_rrhh pr on cast(pr.nv as integer)=cast(c.nv as integer) and pr.ppal=c.ppal
        WHERE legajo=${legajo} order by nc,fechalt
       `
        const db = await connect();
        const [rows] = await db.query(sqlStr);
        res.send(rows)
    } catch (e) {
        console.log(e)
    }
}


///asistencias 
//controles
export const traerHorasTotalesfechas=async (req,res)=>{
    try {
        const { condicion, fechaInicio, fechaFin } = req.params;
        //console.log(condicion, fechaInicio, fechaFin)

        // Validar que los parámetros sean correctos
        if (!condicion || !fechaInicio || !fechaFin) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos' });
        }

        

        // Conexión a la base de datos
        const db = await connect();
        let rows=[]
       if(condicion==='1'){
        
        [rows] = await db.execute(
            `SELECT 
                a.legajo,
                a.apellido,
                COUNT(r.nroregistro) AS cantidad_registros,
                COALESCE(SUM(r.cantidadHoras), 0) AS cantidad_horas_totales
            FROM agentes a
            LEFT JOIN registroasistenciad r ON a.legajo = r.legajo
            WHERE a.condicion = ? 
            AND r.fecha BETWEEN ? AND ?
            GROUP BY a.legajo, a.apellido
            ORDER BY a.apellido`,
            [condicion, fechaInicio, fechaFin]
        );
        }else{
            [rows] = await db.execute(
                `SELECT 
                    a.legajo,
                    a.apellido,
                    COUNT(r.nroregistro) AS cantidad_registros,
                    COALESCE(SUM(r.cantidadHoras), 0) AS cantidad_horas_totales
                FROM agentes a
                LEFT JOIN registroasistenciand r ON a.legajo = r.legajo
                WHERE a.condicion = ? 
                AND r.fecha BETWEEN ? AND ?
                GROUP BY a.legajo, a.apellido
                ORDER BY a.apellido`,
                [condicion, fechaInicio, fechaFin]
            );


        }
       
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener asistencia:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }

}




// Obtener reporte de asistencia y horas presenciales requeridas


export const traerHorasTothorasP = async (req, res) => {
    try {
        const { fechaInicio, fechaFin } = req.query; // Cambio de req.params a req.query
        
        // Verificar si se enviaron las fechas
        if (!fechaInicio || !fechaFin) {
            return res.status(400).json({ error: 'Debe proporcionar fechaInicio y fechaFin en formato YYYY-MM-DD' });
        }

        const db = await connect(); // Asegurar que `connect()` devuelve una conexión válida

        // Consulta SQL corregida
        const query = `
            SELECT 
                  a.legajo,
                  a.apellido,
                COUNT(r.nroregistro) AS cantidad_registros,
                COALESCE(ROUND(SUM(r.cantidadHoras), 2), 0) AS cantidad_horas_totales,
                COALESCE(ROUND(ph.total_horas_presenciales, 2), 0) AS horas_presenciales_requeridas
                
               
            FROM agentes a
            LEFT JOIN (
                SELECT legajo, fecha, nroregistro, cantidadHoras
                FROM registroasistenciad
                WHERE fecha BETWEEN ? AND ?
            ) r ON a.legajo = r.legajo
            LEFT JOIN (
                SELECT 
                    c.legajo, 
                      ROUND(SUM(p.canhp), 2) AS total_horas_presenciales
                FROM cargos c
                JOIN plantacargos_rrhh p 
                    ON c.es = p.es 
                    AND c.ppal = p.ppal 
                    AND c.nv = p.nv
                WHERE c.ppal = '37'  AND NOT c.st IN ('CG', 'SG')
                GROUP BY c.legajo
            ) ph ON a.legajo = ph.legajo
            WHERE a.condicion = '1'
            GROUP BY a.legajo, a.apellido, ph.total_horas_presenciales
            ORDER BY a.apellido;
        `;

        //console.log('Ejecutando consulta:', query);

        // Ejecutar consulta con parámetros seguros
        const [rows] = await db.execute(query, [fechaInicio, fechaFin]);

        res.json(rows);
    } catch (error) {
        console.error('Error al obtener reporte:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

