import {
  getAgente,
  getAgenteName,
  getAgentes,
  getAgentesArea,
  getDias_Persona_fechas,
  getDocenteName,
  getEstadistasHorasD,
  getEstadistasHorasND,
  getHorarioClaustroFechas,
  getHorario_persona_fechas,
  getHorasAreadeTrabajo,
  getHorasT_Persona_fechas,
  changePassAgente,
  newRegistroasistencia,
  registrarSalida,
  getInasistencias_fechas,
  acreditarHorarioVirtual,
  updateAsistencia,
  getInasistenciasPeriodo,
  getLicenciasPeriodo,
  getInasistenciasRpEs,
  buscarAusentes,
  getAsistenciadia,
  traerDatosPromedia,
  getLicenciaAgenteM,
  getInasistenciasHistoricas,
  getAgenteApp,
  getLicenciasHistoricas,
  traerControlAsistenciaPersonal,
  //resetPassAgente,
} from "../controllers/controllers_bio.js";

import { Router } from "express";

const router = Router();

router.get("/activos", getAgentes);
router.get("/agente_leg/:legajo", getAgente);
router.get("/agentes_area/:area", getAgentesArea);
router.get("/agente_name/:strpatron", getAgenteName);
router.get("/docentes/strpatron", getDocenteName);
router.get("/horas_area_fecha/:area/:fecha_i/:fecha_f", getHorasAreadeTrabajo);
router.get(
  "/horario_persofechas/:condi/:leg/:fecha_i/:fecha_f",
  getHorario_persona_fechas
);
router.get(
  "/horario_claustrofechas/:condi/:fecha_i/:fecha_f",
  getHorarioClaustroFechas
);
router.get(
  "/horasestadisticasnodoc/:condi/:fecha_i/:fecha_f",
  getEstadistasHorasND
);
router.get(
  "/horasestadisticasdoc/:condi/:fecha_i/:fecha_f",
  getEstadistasHorasD
);
router.get("/reporteasistenciadia/",traerControlAsistenciaPersonal)
//login: ver POST /biometrico/login en app.js (ruta pública, sin JWT)
//router.get('/asistenciaUpdate/:leg/:nror/:he/:hs', updateAsistencia)

//router.post('/changepass', changePassAgente)
//router.post("/resetpass", resetPassAgente);
router.get(
  "/diasregistrados/:condi/:leg/:fecha_i/:fecha_f",
  getDias_Persona_fechas
);
router.get(
  "/horastotal/:condi/:leg/:fecha_i/:fecha_f",
  getHorasT_Persona_fechas
);
//router.post('/newhorario', newRegistroasistencia)

router.get("/insasisteciasres/:legajo/:fecha_i/:fecha_f", getInasistenciasRpEs);
//router.put('/registrosalida/:condi/:legajo/:nroregistro', registrarSalida)
router.get("/inasistenciasF/:leg/:fecha_i/:fecha_f", getInasistencias_fechas);
router.get("/inasistencias/:fecha_i/:fecha_f", getInasistenciasPeriodo);
router.get("/licencias/:fecha_i/:fecha_f", getLicenciasPeriodo);
//router.put('/acreditarhoras/:legajo/:nroregistro', acreditarHorarioVirtual)

router.get("/getausentes/:fecha", buscarAusentes);

router.get("/asistenciahoy/:fecha", getAsistenciadia);

router.get("/horasregistros/:fecha/:claustro", traerDatosPromedia);

router.get("/licenciaMuestra/:legajo/:nc/:ncg", getLicenciaAgenteM);

//historicos licencias y inasistencias
router.get('/inasistenciasHist/:leg',getInasistenciasHistoricas)
router.get('/licenciasHist/:leg', getLicenciasHistoricas)


//
router.get('/getpersofce/:nrodocumento', getAgenteApp)

export default router;
