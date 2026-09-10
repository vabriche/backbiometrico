import { connect } from '../database.js';

// Controlador que consulta agentes y, adicionalmente, verifica registro de asistencia para la fecha indicada
/*d
export const traerHconsuControl = async (req, res) => {
   
  
       const db = await connect();
  try {
      // Se espera recibir la fecha en el query string, por ejemplo: /consultar-agentes?fecha=2025-03-11
      const fechaConsulta = req.query.fecha;
      const fechaLocal = fechaConsulta.replace(/-/g, "/"); // Cambia '2025-03-10' a '2025/03/10'
      if (!fechaConsulta) {
        return res.status(400).json({ error: "La fecha de consulta es requerida" });
      }
      
     //console.log(fechaConsulta)

      // Validar la fecha
      const date = new Date(fechaLocal);
      if (isNaN(date.getTime())) {
        return res.status(400).json({ error: "Fecha inválida" });
      }
  
      // Obtener el índice del día (0: domingo, 1: lunes, ..., 6: sábado)
      const dayIndex = date.getDay();
   
      //console.log(date)
      // Mapear índice de día a columna de la tabla en español
      const daysMap = {
        1: 'lunes',
        2: 'martes',
        3: 'miercoles',
        4: 'jueves',
        5: 'viernes',
        6: 'sabado'
      };
       //  console.log(dayIndex)
      // Si es domingo (0) no hay consultas asignadas
      if (dayIndex === 0) {
        return res.json({ message: "No hay consultas asignadas para domingos." });
      }
  
      const diaCol = daysMap[dayIndex];
   
      // Construir la consulta SQL que obtiene la persona, el horario de consulta y la asistencia (entrada y salida)
      const sql = `
       SELECT DISTINCT d.leg, a.apellido, d.${diaCol} AS horario,
       IFNULL(r.Hentrada, 'X') AS Hentrada,
       IFNULL(r.Hsalida, 'X') AS Hsalida
        FROM diahoraconsu d
      INNER JOIN agentes a ON a.legajo = d.leg
    LEFT JOIN registroasistenciad r ON r.legajo = d.leg AND r.fecha =' ${fechaConsulta}'
    WHERE d.vigente = 'S' AND LENGTH(d.${diaCol}) > 3
      ORDER BY a.apellido
      `;
  //console.log(sql)
      // Ejecutar la consulta pasando la fecha de consulta como parámetro
      const [rows] = await db.query(sql);
      res.json(rows);
  
    } catch (err) {
      console.error("Error en la consulta:", err);
      res.status(500).json({ error: "Error en la consulta", details: err.message });
    }
  };
*/



  export const traerConsultaDocente = async(req, res)=>{

    const {legajo} = req.params
    try{
    const sql =`
    select d.id_mat,m.materia, lunes,martes,miercoles,jueves,viernes,d.lugar_c ,d.lugar_v   from dbasistencia.diahoraconsu d 
    inner join dbasistencia.materias m on m.id_materia = d.id_mat
    where d.vigente ='S' AND leg=?` 
        
    const [rows] = await db.query(sql,[legajo]);
      res.json(rows);
  
    } catch (err) {
      console.error("Error en la consulta:", err);
      res.status(500).json({ error: "Error en la consulta", details: err.message });
    }

 
  }

//

export const traerHconsuControl = async (req, res) => {
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

    const dayIndex = date.getDay();
    if (dayIndex === 0) {
      return res.json({ message: "No hay consultas asignadas para domingos." });
    }

    const daysMap = {
      1: 'lunes', 2: 'martes', 3: 'miercoles',
      4: 'jueves', 5: 'viernes', 6: 'sabado'
    };
    const diaCol = daysMap[dayIndex];

    const UMBRAL_CUMPLE = req.query.umbralCumple
      ? Number(req.query.umbralCumple)
      : 75;
    const UMBRAL_PARCIAL = req.query.umbralParcial
      ? Number(req.query.umbralParcial)
      : 30;

    if (
      Number.isNaN(UMBRAL_CUMPLE) || Number.isNaN(UMBRAL_PARCIAL) ||
      UMBRAL_PARCIAL < 0 || UMBRAL_CUMPLE > 100 || UMBRAL_PARCIAL >= UMBRAL_CUMPLE
    ) {
      return res.status(400).json({
        error: "Umbrales inválidos: se requiere 0 <= umbralParcial < umbralCumple <= 100"
      });
    }

    const SEDES = { '1': 'MZA', '2': 'SR', '4': 'ESTE' };
    const nombreSede = (codigo) => SEDES[codigo] ?? codigo;

    const sqlConsultas = `
      SELECT d.leg, a.apellido, d.id_mat, d.${diaCol} AS horario,
             d.sede, d.lugar_c, d.lugar_v, d.novedad, d.id_hora,
             m.materia AS nombreMateria
      FROM diahoraconsu d
      INNER JOIN agentes a ON a.legajo = d.leg
      LEFT JOIN materias m ON m.id_materia = CAST(d.id_mat AS UNSIGNED)
      WHERE d.vigente = 'S' AND LENGTH(d.${diaCol}) > 3
      ORDER BY a.apellido
    `;
    const [consultas] = await db.query(sqlConsultas);

    if (consultas.length === 0) {
      return res.json([]);
    }

    const legajos = [...new Set(consultas.map(c => c.leg))];

    const sqlAsistencia = `
      SELECT legajo, Hentrada, Hsalida, nroregistro
      FROM registroasistenciad
      WHERE fecha = ? AND legajo IN (?)
      ORDER BY Hentrada
    `;
    const [asistencias] = await db.query(sqlAsistencia, [fechaConsulta, legajos]);

    const asistenciasPorLegajo = {};
    asistencias.forEach(r => {
      (asistenciasPorLegajo[r.legajo] ??= []).push(r);
    });

    // Inasistencias justificadas que cubren la fecha consultada, para esos legajos
    const sqlInasist = `
      SELECT nleg, mot, fechcom, fechfin
      FROM inasist
      WHERE nleg IN (?) AND fechcom <= ? AND (fechfin IS NULL OR fechfin >= ?)
    `;
    const [inasistencias] = await db.query(sqlInasist, [legajos, fechaConsulta, fechaConsulta]);

    const inasistPorLegajo = {};
    inasistencias.forEach(i => {
      if (!inasistPorLegajo[i.nleg]) {
        inasistPorLegajo[i.nleg] = i.mot;
      }
    });

    const convertirHora = (horaStr) => {
      if (!horaStr || horaStr === 'X') return null;
      const partes = horaStr.split(':').map(Number);
      const [h, m] = partes;
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    };

    const parseBloques = (horarioStr) => {
      if (!horarioStr) return [];
      const regex = /(\d{1,2}:\d{2})\s*a\s*(\d{1,2}:\d{2})/g;
      const bloques = [];
      let match;
      while ((match = regex.exec(horarioStr)) !== null) {
        const ini = convertirHora(match[1]);
        const fin = convertirHora(match[2]);
        if (ini !== null && fin !== null && fin > ini) {
          bloques.push([ini, fin]);
        }
      }
      return bloques;
    };

    const calcularSolape = (bIni, bFin, entrada, salida) => {
      if (entrada === null || salida === null) return { minutos: 0, porcentaje: 0 };
      const inicioSolape = Math.max(bIni, entrada);
      const finSolape = Math.min(bFin, salida);
      const minutos = Math.max(0, finSolape - inicioSolape);
      const duracion = bFin - bIni;
      return { minutos, porcentaje: duracion > 0 ? (minutos / duracion) * 100 : 0 };
    };

    const calcularGap = (bIni, bFin, entrada, salida) => {
      if (entrada === null || salida === null) return Infinity;
      if (salida < bIni) return bIni - salida;
      if (entrada > bFin) return entrada - bFin;
      return 0;
    };

    const clasificar = (pct) => {
      if (pct >= UMBRAL_CUMPLE) return 'S';
      if (pct >= UMBRAL_PARCIAL) return 'P';
      return 'N';
    };

    const prioridad = { N: 0, P: 1, S: 2 };
    const peorEstado = (a, b) => (prioridad[a] <= prioridad[b] ? a : b);

    const resultados = consultas.map(row => {
      const bloques = parseBloques(row.horario);
      const registrosDocente = asistenciasPorLegajo[row.leg] || [];
      const motivoInasistencia = inasistPorLegajo[row.leg] || null;

      const errorParseo = row.horario && row.horario.trim().length > 3 && bloques.length === 0;

      let mejorGlobal = { Hentrada: 'X', Hsalida: 'X', porcentaje: -1 };
      const cumplimientosPorBloque = bloques.map(([bIni, bFin]) => {
        let mejor = { registro: null, minutos: 0, porcentaje: -1, gap: Infinity };

        registrosDocente.forEach(r => {
          const entrada = convertirHora(r.Hentrada);
          const salida = convertirHora(r.Hsalida);
          const { minutos, porcentaje } = calcularSolape(bIni, bFin, entrada, salida);
          const gap = porcentaje === 0 ? calcularGap(bIni, bFin, entrada, salida) : 0;

          const esMejor =
            porcentaje > mejor.porcentaje ||
            (porcentaje === mejor.porcentaje && gap < mejor.gap);

          if (esMejor) {
            mejor = { registro: r, minutos, porcentaje, gap };
          }
        });

        const pctFinal = mejor.porcentaje < 0 ? 0 : mejor.porcentaje;

        if (pctFinal > mejorGlobal.porcentaje || mejorGlobal.porcentaje === -1) {
          if (mejor.registro) {
            mejorGlobal = {
              Hentrada: mejor.registro.Hentrada,
              Hsalida: mejor.registro.Hsalida,
              porcentaje: pctFinal
            };
          } else if (mejorGlobal.porcentaje === -1) {
            mejorGlobal = { Hentrada: 'X', Hsalida: 'X', porcentaje: 0 };
          }
        }

        return clasificar(pctFinal);
      });

      // Si hay inasistencia justificada esa fecha, prima sobre el cálculo de asistencia.
      const cumplimiento = motivoInasistencia
        ? 'J'
        : errorParseo
          ? 'N'
          : cumplimientosPorBloque.length
            ? cumplimientosPorBloque.reduce((acc, c) => peorEstado(acc, c), 'S')
            : 'N';

      return {
        leg: row.leg,
        apellido: row.apellido,
        id_mat: row.id_mat,
        materia: row.nombreMateria || null,
        horario: row.horario,
        sede: nombreSede(row.sede),
        lugar_c: row.lugar_c,
        lugar_v: row.lugar_v,
        novedad: row.novedad,
        errorParseo,
        Hentrada: mejorGlobal.Hentrada,
        Hsalida: mejorGlobal.Hsalida,
        inasistencia: motivoInasistencia, // motivo (mot) si está justificada esa fecha, null si no
        cumplimiento // 'S' cumplido, 'P' parcial, 'N' incumplido, 'J' justificado
      };
    });

    res.json(resultados);
  } catch (err) {
    console.error("Error en la consulta:", err);
    res.status(500).json({ error: "Error en la consulta", details: err.message });
  }
};



export const traerHconsuControlPorPersona = async (req, res) => {
  const db = await connect();
  try {
    const { legajo, fechaInicio, fechaFin } = req.query;
  console.log("legajo:", legajo, "fechaInicio:", fechaInicio, "fechaFin:", fechaFin)
    if (!legajo || !fechaInicio || !fechaFin) {
      return res.status(400).json({ error: "legajo, fechaInicio y fechaFin son requeridos" });
    }

    const parseFecha = (f) => {
      const d = new Date(f.replace(/-/g, "/"));
      return isNaN(d.getTime()) ? null : d;
    };

    const dInicio = parseFecha(fechaInicio);
    const dFin = parseFecha(fechaFin);

    if (!dInicio || !dFin) {
      return res.status(400).json({ error: "Fecha inválida" });
    }
    if (dInicio > dFin) {
      return res.status(400).json({ error: "fechaInicio no puede ser posterior a fechaFin" });
    }

    const UMBRAL_CUMPLE = req.query.umbralCumple ? Number(req.query.umbralCumple) : 75;
    const UMBRAL_PARCIAL = req.query.umbralParcial ? Number(req.query.umbralParcial) : 30;

    if (
      Number.isNaN(UMBRAL_CUMPLE) || Number.isNaN(UMBRAL_PARCIAL) ||
      UMBRAL_PARCIAL < 0 || UMBRAL_CUMPLE > 100 || UMBRAL_PARCIAL >= UMBRAL_CUMPLE
    ) {
      return res.status(400).json({
        error: "Umbrales inválidos: se requiere 0 <= umbralParcial < umbralCumple <= 100"
      });
    }

    const SEDES = { '1': 'MZA', '2': 'SR', '4': 'ESTE' };
    const nombreSede = (codigo) => SEDES[codigo] ?? codigo;

    const daysMap = {
      1: 'lunes', 2: 'martes', 3: 'miercoles',
      4: 'jueves', 5: 'viernes', 6: 'sabado'
    };

    const toISODate = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    // 1) Todos los horarios de consulta vigentes de este docente (una sola vez)
    const sqlConsultas = `
      SELECT d.leg, a.apellido, d.id_mat,
             d.lunes, d.martes, d.miercoles, d.jueves, d.viernes, d.sabado,
             d.sede, d.lugar_c, d.lugar_v, d.novedad, d.id_hora,
             d.f_inicio, d.f_fin,
             m.materia AS nombreMateria
      FROM diahoraconsu d
      INNER JOIN agentes a ON a.legajo = d.leg
      LEFT JOIN materias m ON m.id_materia = CAST(d.id_mat AS UNSIGNED)
      WHERE d.leg = ? AND d.vigente = 'S'
    `;
    const [consultasDocente] = await db.query(sqlConsultas, [legajo]);

    if (consultasDocente.length === 0) {
      return res.json([]);
    }

    const apellidoDocente = consultasDocente[0].apellido;

    // 2) Toda la asistencia del docente en el rango (una sola vez)
    const sqlAsistencia = `
      SELECT fecha, Hentrada, Hsalida, nroregistro
      FROM registroasistenciad
      WHERE legajo = ? AND fecha BETWEEN ? AND ?
      ORDER BY fecha, Hentrada
    `;
    const [asistencias] = await db.query(sqlAsistencia, [legajo, fechaInicio, fechaFin]);

    const asistenciasPorFecha = {};
    asistencias.forEach(r => {
      const key = toISODate(new Date(r.fecha));
      (asistenciasPorFecha[key] ??= []).push(r);
    });

    // 3) Inasistencias del docente que se solapen con el rango consultado (una sola vez)
    const sqlInasist = `
      SELECT mot, fechcom, fechfin
      FROM inasist
      WHERE nleg = ? AND fechcom <= ? AND (fechfin IS NULL OR fechfin >= ?)
    `;
    const [inasistencias] = await db.query(sqlInasist, [legajo, fechaFin, fechaInicio]);

    const convertirHora = (horaStr) => {
      if (!horaStr || horaStr === 'X') return null;
      const partes = horaStr.split(':').map(Number);
      const [h, m] = partes;
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    };

    const parseBloques = (horarioStr) => {
      if (!horarioStr) return [];
      const regex = /(\d{1,2}:\d{2})\s*a\s*(\d{1,2}:\d{2})/g;
      const bloques = [];
      let match;
      while ((match = regex.exec(horarioStr)) !== null) {
        const ini = convertirHora(match[1]);
        const fin = convertirHora(match[2]);
        if (ini !== null && fin !== null && fin > ini) {
          bloques.push([ini, fin]);
        }
      }
      return bloques;
    };

    const calcularSolape = (bIni, bFin, entrada, salida) => {
      if (entrada === null || salida === null) return { minutos: 0, porcentaje: 0 };
      const inicioSolape = Math.max(bIni, entrada);
      const finSolape = Math.min(bFin, salida);
      const minutos = Math.max(0, finSolape - inicioSolape);
      const duracion = bFin - bIni;
      return { minutos, porcentaje: duracion > 0 ? (minutos / duracion) * 100 : 0 };
    };

    const calcularGap = (bIni, bFin, entrada, salida) => {
      if (entrada === null || salida === null) return Infinity;
      if (salida < bIni) return bIni - salida;
      if (entrada > bFin) return entrada - bFin;
      return 0;
    };

    const clasificar = (pct) => {
      if (pct >= UMBRAL_CUMPLE) return 'S';
      if (pct >= UMBRAL_PARCIAL) return 'P';
      return 'N';
    };

    const prioridad = { N: 0, P: 1, S: 2 };
    const peorEstado = (a, b) => (prioridad[a] <= prioridad[b] ? a : b);

    const motivoParaFecha = (fechaISO) => {
      const encontrada = inasistencias.find(i => {
        const desde = toISODate(new Date(i.fechcom));
        const hasta = i.fechfin ? toISODate(new Date(i.fechfin)) : null;
        return desde <= fechaISO && (hasta === null || hasta >= fechaISO);
      });
      return encontrada ? encontrada.mot : null;
    };

    const evaluarFila = (row, horarioStr, fechaISO) => {
      const bloques = parseBloques(horarioStr);
      const registrosDelDia = asistenciasPorFecha[fechaISO] || [];
      const motivoInasistencia = motivoParaFecha(fechaISO);

      const errorParseo = horarioStr && horarioStr.trim().length > 3 && bloques.length === 0;

      let mejorGlobal = { Hentrada: 'X', Hsalida: 'X', porcentaje: -1 };
      const cumplimientosPorBloque = bloques.map(([bIni, bFin]) => {
        let mejor = { registro: null, minutos: 0, porcentaje: -1, gap: Infinity };

        registrosDelDia.forEach(r => {
          const entrada = convertirHora(r.Hentrada);
          const salida = convertirHora(r.Hsalida);
          const { minutos, porcentaje } = calcularSolape(bIni, bFin, entrada, salida);
          const gap = porcentaje === 0 ? calcularGap(bIni, bFin, entrada, salida) : 0;

          const esMejor =
            porcentaje > mejor.porcentaje ||
            (porcentaje === mejor.porcentaje && gap < mejor.gap);

          if (esMejor) {
            mejor = { registro: r, minutos, porcentaje, gap };
          }
        });

        const pctFinal = mejor.porcentaje < 0 ? 0 : mejor.porcentaje;

        if (pctFinal > mejorGlobal.porcentaje || mejorGlobal.porcentaje === -1) {
          if (mejor.registro) {
            mejorGlobal = {
              Hentrada: mejor.registro.Hentrada,
              Hsalida: mejor.registro.Hsalida,
              porcentaje: pctFinal
            };
          } else if (mejorGlobal.porcentaje === -1) {
            mejorGlobal = { Hentrada: 'X', Hsalida: 'X', porcentaje: 0 };
          }
        }

        return clasificar(pctFinal);
      });

      const cumplimiento = motivoInasistencia
        ? 'J'
        : errorParseo
          ? 'N'
          : cumplimientosPorBloque.length
            ? cumplimientosPorBloque.reduce((acc, c) => peorEstado(acc, c), 'S')
            : 'N';

      return {
        fecha: fechaISO,
        leg: row.leg,
        apellido: row.apellido,
        id_mat: row.id_mat,
        materia: row.nombreMateria || null,
        horario: horarioStr,
        sede: nombreSede(row.sede),
        lugar_c: row.lugar_c,
        lugar_v: row.lugar_v,
        novedad: row.novedad,
        errorParseo,
        Hentrada: mejorGlobal.Hentrada,
        Hsalida: mejorGlobal.Hsalida,
        inasistencia: motivoInasistencia,
        cumplimiento,
        // metadato interno para desempatar duplicados por fecha+materia; se quita antes de responder
        _fInicio: row.f_inicio ? toISODate(new Date(row.f_inicio)) : null
      };
    };

    // 4) Iterar cada fecha del rango (en memoria, sin nuevas consultas a la BD)
    const filasCrudas = [];
    const cursor = new Date(dInicio);

    while (cursor <= dFin) {
      const dayIndex = cursor.getDay();
      const fechaISO = toISODate(cursor);

      if (dayIndex !== 0) {
        const diaCol = daysMap[dayIndex];

        consultasDocente.forEach(row => {
          const horarioStr = row[diaCol];
          if (!horarioStr || horarioStr.length <= 3) return;

          const fInicio = row.f_inicio ? toISODate(new Date(row.f_inicio)) : null;
          const fFin = row.f_fin ? toISODate(new Date(row.f_fin)) : null;
          if (fInicio && fechaISO < fInicio) return;
          if (fFin && fechaISO > fFin) return;

          filasCrudas.push(evaluarFila(row, horarioStr, fechaISO));
        });
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    // 5) Deduplicar: si para la misma fecha + misma materia (id_mat) quedó más de una fila
    //    (por mala carga de horarios vigentes superpuestos en diahoraconsu),
    //    nos quedamos con la de f_inicio más reciente.
    const mejorPorClave = new Map();
    filasCrudas.forEach(fila => {
      const clave = `${fila.fecha}|${fila.id_mat}`;
      const actual = mejorPorClave.get(clave);
      if (!actual || (fila._fInicio || '') > (actual._fInicio || '')) {
        mejorPorClave.set(clave, fila);
      }
    });

    const resultados = [...mejorPorClave.values()]
      .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))
      .map(({ _fInicio, ...resto }) => resto); // se quita el metadato interno antes de responder
 //   console.log(resultados)
  
    res.json(resultados);
  //  console.log(`Consulta de control de asistencia para legajo ${legajo} desde ${fechaInicio} hasta ${fechaFin} completada. Filas devueltas: ${resultados.length}`);
  } catch (err) {
    console.error("Error en la consulta:", err);
    res.status(500).json({ error: "Error en la consulta", details: err.message });
  }
};