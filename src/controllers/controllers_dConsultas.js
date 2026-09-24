import { connect } from '../database.js';
//solo consultas referidos a carreras, docentes y sus cargos 

/*
export const getname = async (req, res) => {
    const { parametros } = req.params
    let strqry = `SELECT * FROM tabla WHERE campo=${parametro}`
    try {
        const db = await connect() //instancia connection
        const [rows] = await db.query(strqry) //consulta
        res.send(rows) //envio del resultado
    } catch (error) {
        console.log(error)
    }
}
*/

//cantidad de cargos por tipo
/*
export const getCoutTiposCargosDND =async (req,res)=>{
    const {claustro} = req.params
    let strqry = `select ca,case when ca=1 then 'Efectivo' when ca=2 then 'Interino' when ca=3 then 'Interino Remplazante' when ca=4 then 'Contratado'
    when ca=5 then 'Mensualizado' when ca=6 then 'Jornalizado' when ca=7 then 'Sulente' when ca=8 then 'Asignacion' when ca=9 then 'Beca nv JTP'
    when ca=10 then 'Cargo F.Critica' when ca=11 then 'Interino M.Responzabilidad' when ca=12 then 'Interino Ord.36'
    else 'desconocido' end as tp , count(ca) from dbasistencia.cargos c where es=${claustro} group by c.ca order by c.ca`
    try {
        
    } catch (error) {
        console.log(error)
    }
}
*/
export const getCoutTiposCargosDND = async (req, res) => {
    
    const { claustro } = req.params;
    let strqry = `select ca,
      case 
        when ca=1 then 'Efectivo' 
        when ca=2 then 'Interino' 
        when ca=3 then 'Interino Remplazante' 
        when ca=4 then 'Contratado'
        when ca=5 then 'Mensualizado' 
        when ca=6 then 'Jornalizado' 
        when ca=7 then 'Sulente' 
        when ca=8 then 'Asignacion' 
        when ca=9 then 'Beca nv JTP'
        when ca=10 then 'Cargo F.Critica' 
        when ca=11 then 'Interino M.Responzabilidad' 
        when ca=12 then 'Interino Ord.36'
        else 'desconocido' 
      end as tp, 
      count(ca) 
    from dbasistencia.cargos c 
    where es = ? 
    group by c.ca 
    order by c.ca`;

    try {
        const db = await connect();
        const [rows] = await db.query(strqry, [claustro]);
        res.status(200).json(rows);  // Envía los resultados al cliente en formato JSON.
    } catch (error) {
        console.error('Error al obtener los tipos de cargos:', error);
        res.status(500).send({ message: 'Ocurrió un error al obtener los datos.' });  // Maneja el error devolviendo un mensaje útil.
    }
};




//docentes tipo de cargo
export const getTipoCargo = async (req, res) => {
    const { tipocargo } = req.params;

    const strqry = `SELECT c.legajo, a.apellido, c.nc, c.inst, c.fechalt, c.ppal, c.nv, c.pl, c.car, c.mat
    FROM dbasistencia.cargos c
    INNER JOIN dbasistencia.agentes a ON a.legajo = c.legajo
    WHERE es = '1' AND ca = ?
    ORDER BY inst, a.apellido`;

    try {
        const connection = await connect();
        const [rows] = await connection.query(strqry, [tipocargo]);
        res.status(200).send(rows);
    } catch (error) {
        console.error('Error al obtener los tipos de cargo:', error);
        res.status(500).send({ message: 'Ocurrió un error al obtener los datos.' });
    }
};

/*
export const getTipoCargo = async (req, res)=>{
    const {tipocargo} = req.params
    let strqry = `select c.legajo,a.apellido ,c.nc,c.inst,c.fechalt,c.ppal,c.nv, c.pl,c.car, c.mat  from dbasistencia.cargos c 
    inner join dbasistencia.agentes a on a.legajo = c.legajo 
    where es='1' and ca=${tipocargo} order by inst,a.apellido `
    try {
        const db = await connect()
        const [rows]=await db.query(strqry)
        res.send(rows)
    } catch (error) {
        console.log(error)
    }
}

*/

/*
export const getCargosVigentesReport =async (req,res)=>{
    
    
    const {sede,claustro,tipoc} = req.params
    
    let condicion='where c.es=2 order by age.apellido'

    if (sede==='0' && tipoc==='0' && claustro==='1'){
        condicion=' where c.es=1 order by age.apellido'
    }else if( sede==='0' && tipoc==='0' && claustro==='2'){
        condicion=' where c.es=2 order by age.apellido'
    }else if(sede!=='0' && tipoc==='0' && claustro==='1'){
        condicion=` where c.es=1 and c.inst=${sede} order by age.apellido`
    }else if(sede!=='0' && tipoc==='0' && claustro==='2'){
        condicion=` where c.es=2 and c.inst=${sede} order by age.apellido`
    }else if(sede!=='0' && tipoc!=='0' && claustro==='1'){
        condicion=` where c.es=1 and c.inst=${sede} and c.ca=${tipoc} order by age.apellido`
    }else if(sede!=='0' && tipoc!=='0' && claustro==='2'){
        condicion=` where c.es=2 and c.inst=${sede} and c.ca=${tipoc} order by age.apellido`
    }else if(sede==='0' && tipoc!=='0' && claustro==='1'){
        condicion=` where c.es=1 and c.ca=${tipoc} order by age.apellido`
    }else if(sede==='0' && tipoc!=='0' && claustro==='2'){
        condicion=` where c.es=2 and c.ca=${tipoc} order by age.apellido`
    }

    let strqry =''   
    if (claustro==='2'){
    strqry = `select c.legajo, age.apellido, age.nrocuil, age.area, drh.fechnac,c.ppal , c.nv, c.fechalt, c.nresa, c.fechbaj, case when ca=1 then 'Efectivo' when ca=2 then 'Interino' when ca=3 then 'Interino Remplazante' when ca=4 then 'Contratado'
    when ca=5 then 'Mensualizado' when ca=6 then 'Jornalizado' when ca=7 then 'Sulente' when ca=8 then 'Asignacion' when ca=9 then 'Beca nv JTP'
    when ca=10 then 'Cargo F.Critica' when ca=11 then 'Interino M.Responzabilidad' when ca=12 then 'Interino Ord.36'
    else 'desconocido' end as tp, c.st from dbasistencia.cargos c 
    inner join dbasistencia.agentes age on age.legajo=c.legajo 
    inner join dbasistencia.datos_rrhh drh on drh.legajo=c.legajo ${condicion}` 
    }else if(claustro==='1'){
        strqry = `select c.legajo, age.apellido, age.nrocuil,  drh.fechnac,c.ppal, c.nv, c.car,c.pl, c.mat, c.fechalt, c.nresa, c.fechbaj, case when ca=1 then 'Efectivo' when ca=2 then 'Interino' when ca=3 then 'Interino Remplazante' when ca=4 then 'Contratado'
    when ca=5 then 'Mensualizado' when ca=6 then 'Jornalizado' when ca=7 then 'Sulente' when ca=8 then 'Asignacion' when ca=9 then 'Beca nv JTP'
    when ca=10 then 'Cargo F.Critica' when ca=11 then 'Interino M.Responzabilidad' when ca=12 then 'Interino Ord.36'
    else 'desconocido' end as tp, c.st from dbasistencia.cargos c 
    inner join dbasistencia.agentes age on age.legajo=c.legajo 
    inner join dbasistencia.datos_rrhh drh on drh.legajo=c.legajo ${condicion}`
    }
   
   
    try {
        const db = await connect()
        const [rows]=await db.query(strqry)
        res.send(rows)
        //console.log(rows)

    } catch (error) {
        console.log(error)
    }
}


*/

const construirCondicion = (sede, tipoc, claustro, adicional) => {

    // solo cargos vigentes (la tabla `cargos` tiene la marca `vigente`)
    let condicion = "where c.vigente = 'S' and c.es = ?";
    const params = [claustro === '1' ? '1' : '2'];

    if (claustro === '3') {
        condicion = "where c.vigente = 'S' and c.ppal = ?";
        params[0] = '38';
    }
    if (sede !== '0') {
        condicion += ' and c.inst = ?';
        params.push(sede);
    }
    if (tipoc !== '0') {
        condicion += ' and c.ca = ?';
        params.push(tipoc);
    }
    if (adicional !== '0') {
        condicion += " and c.adic in ('1', '2', '3')";
    }

    return { condicion: condicion + ' order by age.apellido', params };
};

//remplazo de la anterior
export const getCargosVigentesReport =async (req,res)=> {

    const {sede,claustro,tipoc,adicional} = req.params

    const { condicion, params } = construirCondicion(sede, tipoc, claustro, adicional);

let strqry = '';

if (claustro === '2') {
    strqry = `select c.legajo, c.inst, age.apellido, age.nrocuil, age.area, drh.fechnac, c.ppal, c.nv, c.fechalt, c.nresa, c.fechbaj,case when adic=1 then 'FC-D'
    when adic=2 then 'FC-ND' when adic=3 then 'FC-G' end as adic,
    case when ca=1 then 'Efectivo' when ca=2 then 'Interino' when ca=3 then 'Interino Remplazante' when ca=4 then 'Contratado'
    when ca=5 then 'Mensualizado' when ca=6 then 'Jornalizado' when ca=7 then 'Sulente' when ca=8 then 'Asignacion'
    when ca=9 then 'Beca nv JTP' when ca=10 then 'Cargo F.Critica' when ca=11 then 'Interino M.Responzabilidad'
    when ca=12 then 'Interino Ord.36' else 'desconocido' end as tp, c.st, c.rempla
    from dbasistencia.cargos c
    inner join dbasistencia.agentes age on age.legajo=c.legajo
    inner join dbasistencia.datos_rrhh drh on drh.legajo=c.legajo ${condicion}`;
} else if (claustro === '1') {
    strqry = `select c.legajo, c.inst, age.apellido, age.nrocuil, drh.fechnac, c.ppal, c.nv, c.car, c.pl, c.mat, c.fechalt, c.nresa, c.fechbaj, case when adic=1 then 'FC-D'
    when adic=2 then 'FC-ND' when adic=3 then 'FC-G' end as adic,
    case when ca=1 then 'Efectivo' when ca=2 then 'Interino' when ca=3 then 'Interino Remplazante' when ca=4 then 'Contratado'
    when ca=5 then 'Mensualizado' when ca=6 then 'Jornalizado' when ca=7 then 'Sulente' when ca=8 then 'Asignacion'
    when ca=9 then 'Beca nv JTP' when ca=10 then 'Cargo F.Critica' when ca=11 then 'Interino M.Responzabilidad'
    when ca=12 then 'Interino Ord.36' else 'desconocido' end as tp, c.st, c.rempla
    from dbasistencia.cargos c
    inner join dbasistencia.agentes age on age.legajo=c.legajo
    inner join dbasistencia.datos_rrhh drh on drh.legajo=c.legajo ${condicion}`;
} else if (claustro==='3'){
     strqry = `select c.legajo, c.inst, age.apellido, age.nrocuil, age.area, drh.fechnac, c.ppal, c.nv, c.fechalt, c.nresa, c.fechbaj,case when adic=1 then 'FC-D'
    when adic=2 then 'FC-ND' when adic=3 then 'FC-G' end as adic,
    case when ca=1 then 'Efectivo' when ca=2 then 'Interino' when ca=3 then 'Interino Remplazante' when ca=4 then 'Contratado'
    when ca=5 then 'Mensualizado' when ca=6 then 'Jornalizado' when ca=7 then 'Sulente' when ca=8 then 'Asignacion'
    when ca=9 then 'Beca nv JTP' when ca=10 then 'Cargo F.Critica' when ca=11 then 'Interino M.Responzabilidad'
    when ca=12 then 'Interino Ord.36' else 'desconocido' end as tp,
    case when nv=11 then 'Organiz.Ejecutor A' when nv=12 then 'Organiz.Ejecutor B' when nv=13 then 'Organiz.Ejecutor C' when nv=14 then 'Organiz.Ejecutor D'
    when nv=15 then 'Organiz.Ejecutor E' when nv=16 then 'Organiz.Ejecutor F' when nv=17 then 'Organiz.Ejecutor G' when nv=21 then 'Coord.Gestion A D.E.'
    when nv=22 then 'Coord.Gestion A S.E.' when nv=23 then 'Coord.Gestion B D.E.' when nv=24 then 'Coord.Gestion B S.E.' when nv=25 then 'Coord.Gestion C D.E.'
    when nv=26 then 'Coord.Gestion C S.E.' when nv=27 then 'Coord.Gestion D D.E.' when nv=28 then 'Coord.Gestion D S.E.' when nv=29 then 'Coord.Gestion E D.E.'
    when nv=30 then 'Coord.Gestion E S.E.' end as tipoG
    from dbasistencia.cargos c
    inner join dbasistencia.agentes age on age.legajo=c.legajo
    inner join dbasistencia.datos_rrhh drh on drh.legajo=c.legajo ${condicion}`;
}


try {
    const db = await connect();
    const [rows] = await db.query(strqry, params);
    res.status(200).send(rows);
} catch (error) {
    console.error('Error al obtener cargos vigentes:', error);
    res.status(500).send({ message: 'Ocurrió un error al obtener los datos.' });
}

}


export const getFuncionesCriticas = async (req, res)=>{
   
    let strqry = `select distinct ar.legajo, ag.apellido,nrores, DATE_FORMAT(fecha_inicio,"%d-%m-%Y") as fecha_inicio, DATE_FORMAT(fecha_fin,"%d-%m-%Y") as fecha_fin , ar.nc, 
    CASE  when tipoA=1 then 'FC-D' when tipoA=2 then 'FC-ND' when tipoA=3 then 'FC-G' END AS tipofc,
    ar.nc, ar.observacion  from dbasistencia.adicional_rrhh ar 
    inner join dbasistencia.agentes ag on ag.legajo=ar.legajo
    where ar.vigente='S' order by ar.fecha_fin `

    try {
        const db = await connect();
        const [rows] = await db.query(strqry);
        res.status(200).send(rows);
    } catch (error) {
        console.error('Error al obtener las funciones criticas vigentes:', error);
        res.status(500).send({ message: 'Ocurrió un error al obtener los datos.' });
    }



}

