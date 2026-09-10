import { connect } from '../database.js';
import { filtrarColumnasPermitidas } from '../utils/validaciones.js';

// Listas blancas de columnas editables por tabla, para uso con `UPDATE tabla SET ?`
// (ver la nota en utils/validaciones.js sobre por qué hace falta filtrar antes).
const COLUMNAS_AGENTE = ['tipodocumento', 'nrodocumento', 'apellido', 'condicion', 'area', 'encargado_area', 'nrocuil', 'sede', 'asistencia'];
const COLUMNAS_DATOS_PER = ['fechnac', 'lugarn', 'nacionalidad', 'sexo', 'gs', 'rh', 'ecivil', 'tt', 'e', 'ua', 'smil', 'ap', 'fiapn', 'fiunc', 'fifce', 'jub70', 'rcond', 'seguroobligatorio', 'nombre_b', 'doc_b', 'parentesco'];
const COLUMNAS_ANTIGUEDAD = ['aad', 'mad', 'dad', 'aand', 'mand', 'dand', 'fechrecd', 'nresd', 'fechrecnd', 'nresnd', 'fechan', 'ad', 'md', 'dd', 'annd', 'mnd', 'dnd'];
const COLUMNAS_FAMILIA = ['nombre', 'vinculo', 'tdoc', 'nrodoc', 'fechanac'];
const COLUMNAS_CONTACTO = ['domicilio', 'cp', 'localidad', 'telefonoFijo', 'telefonoCelular', 'emailinstitucional', 'emailpersonal', 'telefonocontacto'];
const COLUMNAS_CARGO = ['nc', 'inst', 'ca', 'es', 'ppal', 'nv', 'car', 'pl', 'mat', 'fechalt', 'nresa', 'fechbaj', 'nresb', 'mb', 'st', 'ncg', 'titular', 'vigente', 'adic', 'rempla', 'observaciones'];
const COLUMNAS_CARGO_HIST = ['nc', 'inst', 'ca', 'es', 'ppal', 'nv', 'car', 'pl', 'mat', 'fechalt', 'nresa', 'fechbaj', 'nresb', 'mb', 'st', 'ncg', 'titular', 'adic', 'rempla', 'observaciones'];
const COLUMNAS_INASISTENCIA = ['nc', 'mot', 'r', 'fechcom', 'fechfin', 'nres', 'dias', 'claustro', 'estado'];
const COLUMNAS_LICENCIA = ['nc', 'mot', 'r', 'fechcom', 'fechfin', 'nres', 'reemp', 'vigente', 'fechlim', 'nreslim', 'observaciones', 'ncg'];
const COLUMNAS_ADICIONAL = ['fecha_inicio', 'fecha_fin', 'observacion', 'nc', 'tipoA', 'nrores', 'nresbaja', 'fecha_lim', 'vigente', 'ncg', 'ppal', 'nv', 'cvh', 'row_id'];
const COLUMNAS_ESTUDIO = ['tipotitulo', 'estado', 'titulo', 'institucion', 'adicional', 'establecimiento'];
const COLUMNAS_INSTITUCION = ['nombre', 'codigoI'];
const COLUMNAS_ESTABLECIMIENTO = ['institucion', 'nombre'];
const COLUMNAS_TITULO = ['nombre'];

// funciones complementarias

export const buscarNumero = async (legajo) => {

    try {
        let strqry = `SELECT MAX(nc) + 1 as lastnro FROM cargos WHERE legajo = ?`
        const db = await connect()
        const [rows] = await db.query(strqry, [legajo])
        return rows[0]?.lastnro

    } catch (error) {
        console.log(error)
    }

}

//Datos -------
//###################=============
//NuevoAgente

export const newAgente = async (req, res) => {

    const { legajo, tipodoc, nrodoc, nombre, claustro, nrocuil, area, sede } = req.body
    const strqinsert = 'INSERT INTO agentes(legajo,tipodocumento,nrodocumento,apellido,condicion,nrocuil,area,sede) VALUES(?,?,?,?,?,?,?,?)'
    try {
        const db = await connect()
        const resu = await db.query(strqinsert, [legajo, tipodoc, nrodoc, nombre, claustro, nrocuil, area, sede])
        res.send(resu)

    } catch (error) {
        console.log(error)
    }
}

//modificar datos agentes principal

export const updateAgente = async (req, res) => {
    const { legajo } = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_AGENTE)

    try {
        const db = await connect()
        const resu = await db.query('UPDATE agentes SET ? WHERE legajo=? ', [cambios, legajo])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }

}


//########################=====================
//ver datos personales 

export const getDatosAgentePer = async (req, res) => {
    const { legajo } = req.params
    const strqry = `SELECT DATE_FORMAT(fechnac,"%d-%m-%Y") as fechanac,lugarn,nacionalidad,sexo,gs,rh,ecivil,tt,e,ua,smil,ap,DATE_FORMAT(fiapn,"%d-%m-%Y") as fechaIAPN,DATE_FORMAT(fiunc,"%d-%m-%Y") as fechaIUNC,DATE_FORMAT(fifce,"%d-%m-%Y") as fechaIFCE,DATE_FORMAT(rcond,"%d-%m-%Y") as rcond,jub70 FROM datos_rrhh WHERE legajo = ?`
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [legajo])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }
}

//nuevo dato de Agentes Personal
export const newDatosAgentesPer = async (req, res) => {
    const { legajo, fechnac, lugarn, nacionalidad, sexo, gs, rh, ecivil, fiapn, fiunc, fifce } = req.body

    const sqlins = `INSERT INTO datos_rrhh (legajo,fechnac,lugarn,nacionalidad,sexo,gs,rh,ecivil,fiapn,fiunc,fifce)
        values(?,?,?,?,?,?,?,?,?,?,?)`

    try {
        const db = await connect()
        const resu = await db.query(sqlins, [legajo, fechnac, lugarn, nacionalidad, sexo, gs, rh, ecivil, fiapn, fiunc, fifce])
        res.send(resu)

    } catch (error) {
        console.log(error)
    }
}


//modificar datos personales de agente

export const modiDatosAgentesPer = async (req, res) => {

    const { legajo } = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_DATOS_PER)
    try {
        const db = await connect()
        const resu = await db.query('UPDATE datos_rrhh SET ? WHERE legajo=? ', [cambios, legajo])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}


//%%$$$$$$$$$$$$$$$$$$$$====================
//datos antiguedad

export const getAntiguedadAgente = async (req, res) => {

    const { legajo } = req.params
    const strqry = `SELECT aad,mad,dad,aand,mand,dand,DATE_FORMAT(fechrecd,"%d-%m-%Y") as fechardoc,DATE_FORMAT(fechrecnd,"%d-%m-%Y") as fecharndoc,nresd,nresnd,DATE_FORMAT(fechan,"%d-%m-%Y") as fechaAn,ad,md,dd,annd,mnd,dnd FROM antiguedad_rrhh WHERE legajo = ?`
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [legajo])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }
}


//nuevo registro reconocimiento de antiguedad agente
export const newDatosAgentesAnt = async (req, res) => {

    const { legajo, aad, mad, dad, aand, mand, dand, fechrecd, fechrecnd, nresd, nresnd } = req.body
    const sqlins = `INSERT INTO antiguedad_rrhh(legajo,aad,mad,dad,aand,mand,dand,fechrecd,fechrecnd,nresd,nresnd)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`

    try {
        const db = await connect()
        const resu = await db.query(sqlins, [legajo, aad, mad, dad, aand, mand, dand, fechrecd, fechrecnd, nresd, nresnd])
        res.send(resu)

    } catch (error) {
        console.log(error)
    }
}

//#modificar datos antiguedad agentes
export const modiDatosAgentesAnt = async (req, res) => {

    const { legajo } = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_ANTIGUEDAD)
    try {
        const db = await connect()
        const resu = await db.query('UPDATE antiguedad_rrhh SET ? WHERE legajo=? ', [cambios, legajo])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}


//&&&&########################&&&&
//datos Familia

export const getFamiliaAgente = async (req, res) => {

    const { legajo } = req.params
    const strqry = `SELECT  * FROM familia_rrhh WHERE legajo = ?`
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [legajo])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }
}

//nuevo registro de familiares agentes
export const newDatosAgentesFam = async (req, res) => {

    const { legajo, nombre, vinculo, tdoc, nrodoc, fechanac } = req.body
    const sqlins = `INSERT INTO familia_rrhh (legajo, nombre, vinculo, tdoc, nrodoc,fechanac) VALUES(?, ?, ?, ?, ?, ?)`

    try {
        const db = await connect()
        const resu = await db.query(sqlins, [legajo, nombre, vinculo, tdoc, nrodoc, fechanac])
        res.send(resu)

    } catch (error) {
        console.log(error)
    }
}

//modificacion agente familiares
export const modiDatosAgentesFam = async (req, res) => {

    const { id } = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_FAMILIA)
    try {
        const db = await connect()
        const resu = await db.query('UPDATE familia_rrhh SET ? WHERE id=? ', [cambios, id])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}



//datos persomicontacto
//
export const getDomiContactoAgente = async (req, res) => {

    const { legajo } = req.params
    const strqry = `SELECT * FROM perdomicontacto_rrhh WHERE legajo = ?`
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [legajo])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }
}

//nuevo registro de agente contacto
export const newDatosAgentesContacto = async (req, res) => {

    const { legajo, domicilio, cp, localidad, telefonoFijo, telefonoCelular, emailinstitucional, emailpersonal, telefonocontacto } = req.body
    const sqlins = `INSERT INTO perdomicontacto_rrhh(legajo,domicilio,cp,localidad,telefonoFijo,telefonoCelular,emailinstitucional,emailpersonal,telefonocontacto)VALUES(?,?,?,?,?,?,?,?,?)`

    try {
        const db = await connect()

        const resu = await db.query(sqlins, [legajo, domicilio, cp, localidad, telefonoFijo, telefonoCelular, emailinstitucional, emailpersonal, telefonocontacto])

        res.send(resu)

    } catch (error) {
        console.log(error)
    }
}

//modificar datos contacto agente
export const modiDatosAgentesContacto = async (req, res) => {

    const { legajo } = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_CONTACTO)
    try {
        const db = await connect()
        const resu = await db.query('UPDATE perdomicontacto_rrhh SET ? WHERE legajo=? ', [cambios, legajo])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}

//___________FIN____________MODPER


// ##########################ver cargos vigentes e historicos
// ###########################

//funciones para vrificar datos ncargo y ncgenerado


//ultimo cargo vugente
const getlasTNroCargosVi = async (legajo) => {
     
    try {
    
        let strqry = `SELECT MAX(nc) AS nroC, MAX(ncg) AS nroCg FROM cargos WHERE legajo=?`
  
        const db = await connect()
        const [row] = await db.query(strqry,[legajo])
        console.log(row)
        
        let result={
            nroC:row[0]?.nroC || 0,
            nroCg:row[0]?.nroCg || 0
        }
        
        return result//retorn info
        
        
        //console.log(strqry)
    } catch (error) {
        console.log('Error al obtener Datos',error)
    }
}


//ultimo cargo his
const getlasTNroCargosH = async (legajo) => {
    
    
    try {
    
         let strqry= `SELECT MAX(nc) AS nroC, MAX(ncg) AS nroCg FROM cargoant WHERE legajo = ?`
   
    
        const db = await connect()
        const [row] = await db.query(strqry,[legajo])
       
        const result = {
            nroC: row[0]?.nroC || 0,  // Si no hay 'nroC', se asigna 0
            nroCg: row[0]?.nroCg || 0  // Si no hay 'nroCg', se asigna 0
        };

        return result;  // Retornamos el resultado
        
     
    } catch (error) {
        console.log('Error al Obtener datos',error)
    }
}



//obtenemos y enviamos los NC y NCG ultimos


export const getlasTNroCargos = async (req, res) => {

    const { legajo } = req.params;

    try {
        // Ejecutamos ambas funciones de manera paralela para mayor eficiencia
        const [nroHis, nroVig] = await Promise.all([
            getlasTNroCargosH(legajo),
            getlasTNroCargosVi(legajo)
        ]);

        //console.log(nroVig)
        //console.log(nroHis)
        // Verificamos que ambos resultados existan y tengan los valores esperados
        if (!nroHis || !nroVig) {
            return res.status(404).json({ message: "No se encontraron datos de cargos." });
        }

        // Comparamos los valores de nroC y nroCg para obtener los máximos
        const maxNroCg = Math.max(nroHis.nroCg, nroVig.nroCg);
        const maxNroC = Math.max(nroHis.nroC, nroVig.nroC);

        // Creamos el objeto con los resultados
        const datoNros = {
            nroC: maxNroC,
            nroCg: maxNroCg
        };
        let nrocargos=[]
        nrocargos.push(datoNros)

        // Respondemos con el objeto, no es necesario un array

        res.status(200).json(nrocargos);

    } catch (error) {
        console.error('Error al obtener los números de cargos:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
}

///////
//cargos de planta

export const getCargosPlanta = async (req, res) => {
    const { es, ppal } = req.params
    let strqry = ''
    let params = []
    if (es === '9' && ppal === '9') {
        strqry = `SELECT * FROM plantacargos_rrhh WHERE NOT nv='0' order by cargo`
    } else {
        strqry = `SELECT * FROM plantacargos_rrhh WHERE es = ? AND ppal = ? and NOT nv='0' order by cargo`
        params = [es, ppal]
    }
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, params)
        res.send(rows)
    } catch (error) {
        console.log(error)
    }
}
//cargos vigentes por persona
export const getCargosVigentesAgente = async (req, res) => {

    const { legajo } = req.params
    const strqry = `SELECT row_id,legajo,nc,inst,ca,es,ppal,nv,car,pl,mat,DATE_FORMAT(fechalt,"%d-%m-%Y") as fechaAlta ,nresa,DATE_FORMAT(fechbaj,"%d-%m-%Y") as fechaBaja,nresb,mb,st,ncg,titular,adic,rempla, observaciones FROM cargos WHERE legajo = ? and vigente='S' order by nc,fechalt`
    try {

        const db = await connect()
        const [rows] = await db.query(strqry, [legajo])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }
}

//cargos no vigentes por persona
export const getCargosHistoricosAgentes = async (req, res) => {

    const { legajo } = req.params

    const strqry = `SELECT row_id,legajo,nc,inst,ca,es,ppal,nv,car,pl,mat,DATE_FORMAT(fechalt,"%d-%m-%Y") as fechaAlta ,nresa,DATE_FORMAT(fechbaj,"%d-%m-%Y") as fechaBaja,nresb,mb,st,ncg,titular,adic,rempla, observaciones FROM cargoant WHERE legajo = ? order by nc,fechalt`
    try {

        const db = await connect()
        const [rows] = await db.query(strqry, [legajo])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }

}



// # Ver cargos interinos
//cargos vigentes interinos docentes
export const getCargosVigentesInterinos = async (req, res) => {

    let cab = 'SELECT cg.legajo,age.apellido,cg.row_id,cg.nc,cg.inst,cg.ca,cg.es,cg.ppal,cg.nv,cg.car,cg.pl,cg.mat,DATE_FORMAT(cg.fechalt,"%d-%m-%Y") as fechaAlta ,cg.nresa,cg.titular, cg.vigente,cg.adic FROM cargos as cg '
    let innerJ = 'INNER JOIN agentes as age ON age.legajo = cg.legajo '
    let whei = 'WHERE cg.es=1 and cg.vigente="S" AND ca in (2,3) order by age.apellido,cg.car, cg.nc,fechalt'
    let strqry = `${cab}${innerJ}${whei}`
    try {

        const db = await connect()
        const [rows] = await db.query(strqry)
        res.send(rows)
    } catch (error) {
        console.log(error)
    }
}

//cargos contratados no docentes

export const getCargosVigentesInterinosND = async (req, res)=>{
    
    
    let strqry=`select cg.legajo,age.apellido,cg.row_id,cg.nc,cg.inst,cg.ca,cg.es,cg.ppal,cg.nv,age.area,DATE_FORMAT(cg.fechalt,"%d-%m-%Y") as fechaAlta ,cg.nresa,cg.titular, cg.vigente,cg.adic
    from dbasistencia.cargos cg inner join dbasistencia.agentes age on age.legajo=cg.legajo
    where es=2 and ca=4 and vigente='S' `

        try {

            const db = await connect()
            const [rows] = await db.query(strqry)
            res.send(rows)
        } catch (error) {
            console.log(error)
        }

}



//export const renovarCargo =(req,res)=>{

//}


export const darBajaCargo = async (req, res) => {

    const { nroreg, legajo, } = req.params

    const strBj = `DELETE FROM cargos WHERE legajo = ? AND row_id = ? `
    try {
        const db = await connect()
        const resu = await db.query(strBj, [legajo, nroreg])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}



//eliminar un cargo historico
export const darBajaCargoHistorico = async (req, res) => {

    const { nroreg, legajo, } = req.params

    const strBj = `DELETE FROM cargoant WHERE legajo = ? AND row_id = ? `
    try {
        const db = await connect()
        const resu = await db.query(strBj, [legajo, nroreg])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}


///cargo nuevo
export const createCargoNuevo = async (req, res) => {

    try {
        const { legajo, ncargo, sede, tcargo, claustro, ppal, nivel, adic, plan, codmat, fechaA, nroresA, fechaB, ncg, titu, car, rempl, st , observaciones} = req.body


        const strqry = "INSERT INTO cargos (legajo,nc,inst,ca,es,ppal,nv,pl,mat,fechalt,nresa,adic,titular,ncg,fechbaj,car,rempla,st, observaciones) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        const params = [legajo, ncargo, sede, tcargo, claustro, ppal, nivel, plan, codmat, fechaA, nroresA, adic, titu, ncg, fechaB, car, rempl, st, observaciones]

        const db = await connect()
        const resu = await db.query(strqry, params)

        res.send(resu)



    } catch (error) {
        console.log(error)
    }
}

//nuevocargoHistorico
export const createCargoNuevoHist = async (req, res) => {

    try {
        const { legajo, ncargo, sede, tcargo, claustro, ppal, nivel, adic, plan, codmat, fechaA, nroresA, fechaB, nroresB, ncg, titu, car, motbj, sit, rempl, observaciones } = req.body


        const strqry = "INSERT INTO cargoant (legajo,nc,inst,ca,es,ppal,nv,pl,mat,fechalt,nresa,adic,titular,ncg,fechbaj,nresb,car,st,mb,rempla, observaciones) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        const params = [legajo, ncargo, sede, tcargo, claustro, ppal, nivel, plan, codmat, fechaA, nroresA, adic, titu, ncg, fechaB, nroresB, car, sit, motbj, rempl, observaciones]

        const db = await connect()
        const resu = await db.query(strqry, params)

        res.send(resu)



    } catch (error) {
        console.log(error)
    }

}

//modificar cargo

export const updateCargo = async (req, res) => {
    const { nroreg } = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_CARGO)

    try {
        const db = await connect()
        const resu = await db.query('UPDATE cargos SET ? WHERE row_id=? ', [cambios, nroreg])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }

}


export const updateCargoH = async (req, res) => {
    const { nroreg } = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_CARGO_HIST)

    try {
        const db = await connect()
        const resu = await db.query('UPDATE cargoant SET ? WHERE row_id=? ', [cambios, nroreg])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }

}



/////

// Inasistencias y Licencias

//buscar motivos inasistencias
export const getMotivosInasistencias = async (req, res) => {

    let strqry = 'SELECT * FROM motina'
    try {
        const db = await connect()
        const [rows] = await db.query(strqry)
        res.send(rows)
    } catch (error) {
        console.log(error)
    }

}




//inasistencias
//************** */
//inasistencias agentes del año en curso de los motivos 02,04,32
//si no se elige un motivo muestra todos
export const getInasistenciasAgente = async (req, res) => {

    const { legajo, tipo, motivo } = req.params
    const anio = new Date().getFullYear()

    let strqry = ''
    let params = []
    if (tipo === '1') {
        strqry = `SELECT id_ina,nleg,nc,mot,r,DATE_FORMAT(fechcom,"%d-%m-%Y") as fechai,DATE_FORMAT(fechfin,"%d-%m-%Y") as fechaf,nres, estado FROM inasist WHERE nleg = ? ORDER BY fechcom desc`
        params = [legajo]
    } else {
        strqry = `SELECT id_ina,nleg,nc,mot,r,DATE_FORMAT(fechcom,"%d-%m-%Y") as fechai,DATE_FORMAT(fechfin,"%d-%m-%Y") as fechaf,nres, estado FROM inasist WHERE nleg = ? and YEAR(fechcom) = ? AND mot = ? ORDER BY fechcom desc`
        params = [legajo, anio, motivo]
    }

    try {
        const db = await connect()
        const [rows] = await db.query(strqry, params)
        res.send(rows)
    } catch (error) {
        console.log(error)
    }

}

//traer inasistencias
export const getInasistencias = async (req, res) => {

    const { legajo } = req.params
    const anio = new Date().getFullYear()

    const strqry = `SELECT id_ina,nleg,nc,mot,r,DATE_FORMAT(fechcom,"%d-%m-%Y") as fechai,DATE_FORMAT(fechfin,"%d-%m-%Y") as fechaf,nres, estado FROM inasist WHERE nleg = ? and YEAR(fechcom) = ?  ORDER BY fechcom desc`
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [legajo, anio])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }

}

//cargar inasistencia
export const NewInasistencia = async (req, res) => {

    try {
        const { legajo, ncargo, motivo, nr, fechaini, fechafin, nrores, estado } = req.body
        const sqli = 'INSERT INTO inasist(nleg,nc,mot,r,fechcom,fechfin,nres, estado) VALUES(?,?,?,?,?,?,?,?)'
        const db = await connect()
        const resu = await db.query(sqli, [legajo, ncargo, motivo, nr, fechaini, fechafin, nrores, estado])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}

// eliminar una inasistencia mal cargada
export const deleteInasistencia = async (req, res) => {

    const { id, legajo } = req.params
    try {
        const strqd = `DELETE FROM inasist WHERE id_ina = ? AND nleg = ?`
        const db = await connect()
        const resud = await db.query(strqd, [id, legajo])
        res.send(resud)
    } catch (error) {
        console.log(error)

    }

}

//modificar inasistencia
export const updateInasistencia = async (req, res) => {
    const { id, legajo } = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_INASISTENCIA)

    try {
        const db = await connect()
        const resu = await db.query('UPDATE inasist SET ? WHERE id_ina=? AND nleg=? ', [cambios, id, legajo])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }

}



//Licencias


export const getLicenciasAgente = async (req, res) => {

    const { legajo } = req.params
   

    let strqry = `
            (SELECT 'C.Vig.' as ec, lic.row_id, lic.nleg, cg.ca, cg.ppal, cg.nv, lic.nc, lic.ncg, lic.mot, lic.r, DATE_FORMAT(lic.fechcom,"%Y-%m-%d") as fechai,
             DATE_FORMAT(lic.fechfin,"%Y-%m-%d") as fechaf, lic.nres, lic.vigente,DATE_FORMAT(lic.fechlim,"%Y-%m-%d") as fechaLim, lic.nreslim, lic.observaciones 
            FROM licencia as lic 
            INNER JOIN cargos as cg on cg.legajo=lic.nleg and cg.nc=lic.nc and cg.ncg=lic.ncg 
            WHERE lic.nleg = ?)  
            UNION ALL
            (SELECT 'C.His.' as ec, lic.row_id, lic.nleg, cg.ca, cg.ppal, cg.nv, lic.nc,lic.ncg, lic.mot, lic.r, DATE_FORMAT(lic.fechcom,"%Y-%m-%d") as fechai, 
            DATE_FORMAT(lic.fechfin,"%Y-%m-%d") as fechaf, lic.nres, lic.vigente,DATE_FORMAT(lic.fechlim,"%Y-%m-%d") as fechaLim, lic.nreslim, lic. observaciones 
            FROM licencia as lic 
            INNER JOIN cargoant as cg on cg.legajo=lic.nleg and cg.nc=lic.nc and cg.ncg=lic.ncg 
            WHERE lic.nleg = ?)  
            ORDER BY fechai DESC`;

            try {
                const db = await connect();
                const [rows] = await db.query(strqry, [legajo, legajo]);
                res.send(rows);
            } catch (error) {
                console.log(error);
                res.status(500).send('Error en la base de datos');
            }

}

//cargar licencias
/*
export const NewLicencia = async (req, res) => {

    //const { idcargo } = req.params

    try {
        const { legajo, ncargo, motivo, nr, fechaini, fechafin, nrores, ncgen } = req.body
        let cab = 'INSERT INTO licencia(nleg,nc,mot,r,fechcom,fechfin,nres,ncg) VALUES('
        let valores = `${legajo},${ncargo},'${motivo}','${nr}','${fechaini}','${fechafin}','${nrores}',${ncgen})`
        let sqli = `${cab}${valores}`
        const db = await connect()
        const resu = await db.query(sqli)
        await modiCargolic(legajo, ncargo, ncgen, nr)
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}
*/

export const NewLicencia = async (req, res) => {
    try {
        // Extraer los datos del cuerpo de la solicitud
        const { legajo, ncargo, motivo, nr, fechaini, fechafin, nrores, ncgen, observaciones } = req.body;
        
        // Validar que los campos requeridos estén presentes
        if (!legajo || !ncargo || !motivo || !nr || !fechaini || !fechafin || !nrores || !ncgen) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' });
        }

        // Preparar la consulta usando parámetros preparados
        const query = `
            INSERT INTO licencia (nleg, nc, mot, r, fechcom, fechfin, nres, ncg, observaciones) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const values = [legajo, ncargo, motivo, nr, fechaini, fechafin, nrores, ncgen, observaciones];

        // Conectar a la base de datos y ejecutar la consulta
        const db = await connect();
        const [result] = await db.query(query, values);

        // Llamar a modiCargolic después de insertar la licencia
        await modiCargolic(legajo, ncargo, ncgen, nr);

        // Devolver el resultado de la operación
        res.status(201).json({ message: 'Licencia creada exitosamente', result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear la licencia' });
    }
};

const modiCargolic = async (legajo, ncargo, ncgen, nr) => {
    try {
        const strupdate = `UPDATE cargos SET st = ? WHERE legajo = ? AND nc = ? AND ncg = ?`
        const db = await connect()
        const resu = await db.query(strupdate, [nr, legajo, ncargo, ncgen])

        return resu
    } catch (error) {
        console.log(error)
    }
}

//eliminar una licencia 
export const deleteLicencia = async (req, res) => {
    
    const { id, legajo,ncargo,ncgen } = req.params;

    try {
        const db = await connect();

        // Consulta segura usando parámetros
        let strqd = 'DELETE FROM licencia WHERE row_id = ? AND nleg = ?';
        const values = [id, legajo];
        //console.log(values)
        const resud = await db.query(strqd, values);
        console.log(resud[0].affectedRows)
        if (resud[0].affectedRows > 0) {
            res.status(200).json({ message: 'Licencia eliminada correctamente' });
            await modiCargolic(legajo, ncargo, ncgen, '');
        } else {
            res.status(404).json({ message: 'Licencia no encontrada' });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error interno del servidor' });
    } 
};

//dar de baja licencia limitacion
export const bajaLicencia =async (req, res)=>{
    
    const {id, legajo, ncargo, ncgen} = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_LICENCIA)

    try {

        const db = await connect();
        const strqry = `UPDATE licencia SET ? WHERE row_id = ? AND nleg = ?`
        const resud=await db.query(strqry, [cambios, id, legajo])
        await modiCargolic(legajo, ncargo, ncgen, '');

    if (resud[0].affectedRows > 0) {
        res.status(200).json({ message: 'Licencia dada de baja   correctamente' });
    } else {
        res.status(404).json({ message: 'Licencia no encontrada' });
    }

    } catch (error) {
        console.error(error)
        res.status(500).json({message:'Error Interno del Servidor'});    
    }
}




//
//
//consultas varias
//año de ingreso

export const getIngresoAñoAgentes = async (req, res) => {
    const { anioI, lugarI } = req.params
    try {
        const strqryC = 'SELECT age.legajo,age.apellido, DATE_FORMAT(da.fiapn,"%d-%m-%Y") as fechaIAPN,DATE_FORMAT(da.fiunc,"%d-%m-%Y") as fechaIUNC,DATE_FORMAT(da.fifce,"%d-%m-%Y") as fechaIFCE FROM datos_rrhh as da'
        const strqryI = ' INNER JOIN agentes as age ON age.legajo=da.legajo'
        let strqryW = ''
        if (lugarI === '1') {
            strqryW = ` WHERE EXTRACT(YEAR FROM fifce) = ?`
        } else if (lugarI === '2') {
            strqryW = ` WHERE EXTRACT(YEAR FROM fiunc) = ?`

        } else if (lugarI === '3') {
            strqryW = ` WHERE EXTRACT(YEAR FROM fiapn) = ?`
        }

        const strquery = `${strqryC}${strqryI}${strqryW}`

        const db = await connect()
        const [resu] = await db.query(strquery, [anioI])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}

//verificar cumple en año corriente
export const getAgentescumpleEdad = async (req, res) => {
    const { edad } = req.params

    const strqry = `SELECT age.legajo,age.apellido, DATE_FORMAT(da.fechnac ,"%d-%m-%Y") as fechaNac,EXTRACT(YEAR FROM CURDATE()) as anioR,TIMESTAMPDIFF(YEAR,Fechnac,CURDATE()) as edad FROM datos_rrhh as da
        INNER JOIN agentes as age ON age.legajo=da.legajo WHERE EXTRACT(YEAR FROM CURDATE()) - EXTRACT(YEAR FROM fechnac) = ?`

    try {
        const db = await connect()
        const [resu] = await db.query(strqry, [edad])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}




//lugar de nacimiento
export const getLugarNac = async (req, res) => {

    let strqry = 'SELECT * FROM codlugar_rrhh'
    try {
        const db = await connect()
        const [resu] = await db.query(strqry)
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}


//Adicionales fc y adicional por 

export const getAdicionalesAgente = async (req, res) => {

    const { legajo } = req.params

    const strqry = `SELECT id_row,row_id,legajo,nc,ppal,nv,nrores,nresbaja,tipoA,DATE_FORMAT(fecha_inicio,"%Y-%m-%d") as fechai,DATE_FORMAT(fecha_fin,"%Y-%m-%d") as fechaf,observacion,vigente,
    DATE_FORMAT(fecha_lim,"%Y-%m-%d") as fechalim FROM adicional_rrhh WHERE legajo = ? ORDER BY fecha_inicio desc`
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [legajo])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }

}


//cargar un adicional

export const createAdicionalNuevo = async (req, res) => {

    try {
        const { legajo, nc, fecha_inicio, nrores, fecha_fin, tipoA, observacion, vigente, ncg, ppal, nv, row_id,cvh } = req.body

        const strqry = "INSERT INTO adicional_rrhh (legajo,nc,fecha_inicio,nrores,fecha_fin,tipoA,observacion,vigente,ncg,ppal,nv,row_id,cvh) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
        const params = [legajo, nc, fecha_inicio, nrores, fecha_fin, tipoA, observacion, vigente, ncg, ppal, nv, row_id, cvh]

        const db = await connect()
        const resu = await db.query(strqry, params)

        res.send(resu)



    } catch (error) {
        console.log(error)
    }
}

const modiCargoAdic = async (legajo, row_id,adic) => {
    try {
        const strupdate = `UPDATE cargos SET adic = ? WHERE legajo = ? AND row_id = ?`
        const db = await connect()
        const resu = await db.query(strupdate, [adic, legajo, row_id])

        return resu
    } catch (error) {
        console.log(error)
    }
}

//
//dar baja un adicional
export const darBajaAdicional =async (req, res)=>{

    const {legajo, idR, row_id} = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_ADICIONAL)

    try {

        const db = await connect();
        const strqry = 'UPDATE adicional_rrhh SET ? WHERE id_row=? and legajo=?'
        const resud=await db.query(strqry, [cambios, idR, legajo])
        await modiCargoAdic(legajo, row_id, '0');

    if (resud[0].affectedRows > 0) {
        res.status(200).json({ message: 'adicional dada de baja   correctamente' });
    } else {
        res.status(404).json({ message: 'Adicional no encontrada' });
    }

    } catch (error) {
        console.error(error)
        res.status(500).json({message:'Error Interno del Servidor'});
    }
}


//borrar un adicional mal cargado

export const deleteAdicional = async (req, res) => {

    const { id, legajo } = req.params
    try {
        const strqd = `DELETE FROM adicional_rrhh WHERE id_row = ? AND legajo = ?`
        const db = await connect()
        const resud = await db.query(strqd, [id, legajo])
        res.send(resud)
    } catch (error) {
        console.log(error)

    }

}


//&&&&########################&&&&
//datos Estudios de los agentes

export const getEstudiosAgente = async (req, res) => {

    const { legajo } = req.params
    const strqry = `SELECT es.id_row,es.legajo,tit.nombre as titulo,
     CASE es.tipotitulo WHEN 1 THEN 'Secundario' WHEN 2 THEN 'Terciario' WHEN 3 THEN 'Grado' WHEN 4 THEN 'Especialista'
     WHEN 5 THEN 'Magister' WHEN 6 THEN 'Doctorado' WHEN 7 THEN 'Diplomatura' WHEN 8 THEN 'Curso' END AS tp,
     CASE es.estado WHEN 1 THEN 'Finalizado' WHEN 2 THEN 'En Proceso' END AS situacion,ins.nombre as insti, est.nombre as esta, CASE es.adicional WHEN 1 THEN 'SI' WHEN 2 THEN 'NO' END AS adi
     , es.titulo as ti, es.establecimiento as esb, es.institucion as ititu, es.estado,es.adicional,es.tipotitulo FROM dbasistencia.estudios_rrhh es
     inner join establecimientos est on est.id_row =es.establecimiento
     inner join instituciones ins on ins.id_row =es.institucion
     inner join titulos tit on tit.id_row = es.titulo
     where es.legajo = ?`

    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [legajo])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }
}

//nuevo registro de familiares agentes
export const newDatosAgentesEstudio = async (req, res) => {

    const { legajo, tipotitulo, estado, titulo, institucion, establecimiento, adicional } = req.body
    const sqlins = `INSERT INTO estudios_rrhh (legajo, tipotitulo, estado, titulo, institucion,establecimiento ,adicional) VALUES(?,?,?,?,?,?,?)`

    try {
        const db = await connect()
        const resu = await db.query(sqlins, [legajo, tipotitulo, estado, titulo, institucion, establecimiento, adicional])
        res.send(resu)

    } catch (error) {
        console.log(error)
    }
}

//modificacion agente familiares
export const modiDatosAgentesEstudio = async (req, res) => {
    const { id } = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_ESTUDIO)
    try {
        const db = await connect()
        const resu = await db.query('UPDATE estudios_rrhh SET ? WHERE id_row=? ', [cambios, id])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}

// eliminar un estudio
export const deleteDatoAgenteEstudio = async (req, res) => {

    const { id, legajo } = req.params
    try {
        const strqd = `DELETE FROM estudios_rrhh WHERE id_row = ? AND legajo = ?`
        const db = await connect()
        const resud = await db.query(strqd, [id, legajo])
        res.send(resud)
    } catch (error) {
        console.log(error)

    }

}
//instituciones
//traer
export const getInstituciones = async (req, res) => {
    try {
        const db = await connect()
        const [rows] = await db.query('SELECT * FROM instituciones ORDER BY nombre')
        res.send(rows)
    } catch (error) {
        console.log(error)
    }
}

//grabar
export const grabarInstitucion = async (req, res) => {

    const { codigoI, nombre } = req.body
    const insStr = `INSERT INTO instituciones (codigoI, nombre) VALUES(?,?)`

    try {
        const db = await connect()
        const resu = await db.query(insStr, [codigoI, nombre])
        res.send(resu)

    } catch (error) {
        console.log(error)
    }
}

//modificar
export const modiDatosInstitucion = async (req, res) => {

    const { id } = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_INSTITUCION)

    try {
        const db = await connect()
        const resu = await db.query('UPDATE instituciones SET ? WHERE id_row=? ', [cambios, id])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}

// eliminar una institucion
export const deleteIstitucion = async (req, res) => {

    const { id } = req.params
    try {
        const strqd = `DELETE FROM instituciones WHERE id_row = ?`
        const db = await connect()
        const resud = await db.query(strqd, [id])
        res.send(resud)
    } catch (error) {
        res.send(error)

    }

}

// establecimientos
export const getEstablecimientos = async (req, res) => {
    const { insti } = req.params
    try {
        const db = await connect()
        const [rows] = await db.query(`SELECT * FROM establecimientos WHERE institucion = ? ORDER BY nombre`, [insti])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }
}
//grabar
export const grabarEstablecimiento = async (req, res) => {

    const { institucion, nombre } = req.body
    const insStr = `INSERT INTO establecimientos (institucion, nombre) VALUES(?,?)`
    try {

        const db = await connect()
        const resu = await db.query(insStr, [institucion, nombre])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}

//modificar
export const modiDatosEstablecimiento = async (req, res) => {

    const { id } = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_ESTABLECIMIENTO)
    try {

        const db = await connect()
        const resu = await db.query('UPDATE establecimientos SET ? WHERE id_row=? ', [cambios, id])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}

// eliminar una establecimineto
export const deleteEstablecimiento = async (req, res) => {

    const { id } = req.params
    try {
        const strqd = `DELETE FROM establecimientos WHERE id_row = ?`
        const db = await connect()
        const resud = await db.query(strqd, [id])
        res.send(resud)
    } catch (error) {
        console.log(error)

    }

}


//titulos
export const getTitulos = async (req, res) => {

    try {
        const db = await connect()
        const [rows] = await db.query('SELECT * FROM titulos ORDER BY nombre')
        res.send(rows)
    } catch (error) {
        console.log(error)
    }
}

//grabar
export const grabarTitulo = async (req, res) => {

    const { nombre } = req.body
    const insStr = `INSERT INTO titulos(nombre) VALUES(?)`
    try {
        const db = await connect()
        const resu = await db.query(insStr, [nombre])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}

//modificar
export const modiDatosTitulo = async (req, res) => {
    const { id } = req.params
    const cambios = filtrarColumnasPermitidas(req.body, COLUMNAS_TITULO)
    try {
        const db = await connect()
        const resu = await db.query(`UPDATE titulos SET ? WHERE id_row=? `, [cambios, id])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}

// eliminar un Titulo
export const deleteTitulo = async (req, res) => {

    const { id } = req.params
    try {
        const strqd = `DELETE FROM titulos WHERE id_row = ?`
        const db = await connect()
        const resud = await db.query(strqd, [id])
        res.send(resud)
    } catch (error) {
        console.log(error)

    }

}

export const buscarAntiguedadvaca =async (req,res)=>{
    const {legajo} = req.params

    const strqry = `SELECT * FROM vacaciones_rrhh WHERE legajo = ?`
    try {
        const db = await connect()
        const [rows] = await db.query(strqry, [legajo])
        res.send(rows)
    } catch (error) {
        console.log(error)
    }



}



///////
//cargar licencias
export const newRegistroRRHH = async (req, res) => {

    //const { idcargo } = req.params

    try {
        const { legajo,ncargo,ncgen,ppal,nv,nroresa,nroreb,fechaini,fechafin,observacion,tipoR } = req.body
        const sqli = 'INSERT INTO registros_rrhh(legajo,nc,ncg,ppal,nv,nroresa,nroresb,fecha_inicio,fecha_fin,observacion,tipoR) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
        const db = await connect()
        const resu = await db.query(sqli, [legajo, ncargo, ncgen, ppal, nv, nroresa, nroreb, fechaini, fechafin, observacion, tipoR])
        res.send(resu)
    } catch (error) {
        console.log(error)
    }
}

const modiRegistroRRHH = async (req,res) => {
  
    const {id}=req.params
    try {
       
        const db = await connect()
        const resu = await db.query('UPDATE registros_rrhh SET ? WHERE id=? ', [req.body, id])
        return resu
    } catch (error) {
        console.log(error)
    }
}

// eliminar una tipo cargo mal cargada
export const deleteRegistroRRHH = async (req, res) => {

    const { id, legajo } = req.params
    try {
        const strqd = `DELETE FROM registros_rrhh WHERE row_id = ? AND legajo = ?`
        const db = await connect()
        const resud = await db.query(strqd, [id, legajo])
        res.send(resud)
    } catch (error) {
        console.log(error)

    }

}