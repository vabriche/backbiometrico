import { Router } from "express";
import {
  getAgentesVacaciones,
  getPersonalVacaciones,
  getPersonalOrigen,
  generarPersonal,
  crearPersonalVacaciones,
  modiPersonalVacaciones,
  ajustarDerecho,
  getPeriodosVacaciones,
  crearPeriodo,
  generarDerechos,
  modiPeriodo,
  deletePeriodo,
  getDatosPedido,
  getResumenEmpleado,
  soloEmpleado,
  inicioDesdeHoy,
  getTramosVacaciones,
  getHistoriaVacaciones,
  prepararPedido,
  registrarTramo,
  aprobarTramo,
  cancelarTramo,
  registrarInterrupcion,
  validarInterrupcion,
  getTramosPendientes,
  getInterrupcionesPendientes,
  getFeriados,
  crearFeriado,
  deleteFeriado,
  getEscala,
  modiEscala,
  modificarTramoEmpleado,
  getTramosJefe,
  vistoBuenoTramo,
  rechazarTramoJefe,
  quitarVistoBuenoTramo,
  getInterrupcionesJefe,
  vistoBuenoInterrupcion,
  rechazarInterrupcionJefe,
} from "../controllers/controllers_vacaciones.js";

// Licencia anual ordinaria (vacaciones). Ver sql/licencia_anual_actualizacion.sql.
const router = Router();

// App del empleado: el legajo sale del token (soloEmpleado pisa cualquier legajo recibido)
router.get("/empleado/resumen", getResumenEmpleado);
router.post("/empleado/preparar", soloEmpleado, inicioDesdeHoy(true), prepararPedido);
router.post("/empleado/tramos", soloEmpleado, inicioDesdeHoy(), registrarTramo);
router.get("/empleado/tramos", soloEmpleado, getTramosVacaciones);
router.post("/empleado/tramos/:id/modificar", soloEmpleado, inicioDesdeHoy(), modificarTramoEmpleado);

// Visto bueno del jefe del área (rol y área salen del token)
router.get("/jefe/tramos", getTramosJefe);
router.post("/jefe/tramos/:id/visto-bueno", vistoBuenoTramo);
router.post("/jefe/tramos/:id/rechazar", rechazarTramoJefe);
router.post("/jefe/tramos/:id/quitar-visto-bueno", quitarVistoBuenoTramo);
router.get("/jefe/interrupciones", getInterrupcionesJefe);
router.post("/jefe/interrupciones/:id/visto-bueno", vistoBuenoInterrupcion);
router.post("/jefe/interrupciones/:id/rechazar", rechazarInterrupcionJefe);

// Bandejas y parámetros (antes que las rutas con :legajo)
router.get("/agentes", getAgentesVacaciones);
router.get("/pendientes", getTramosPendientes);
router.get("/interrupciones/pendientes", getInterrupcionesPendientes);
router.get("/periodos", getPeriodosVacaciones);
router.post("/periodos/:periodo", crearPeriodo);
router.put("/periodos/:periodo", modiPeriodo);
router.delete("/periodos/:periodo", deletePeriodo);
router.post("/periodos/:periodo/generar", generarDerechos);
router.get("/feriados", getFeriados);
router.post("/feriados", crearFeriado);
router.delete("/feriados/:fecha", deleteFeriado);
router.get("/escala", getEscala);
router.put("/escala", modiEscala);

// Personal y derechos
router.get("/personal", getPersonalVacaciones);
router.post("/personal", crearPersonalVacaciones);
router.get("/personal/origen", getPersonalOrigen);
router.post("/personal/generar", generarPersonal);
router.put("/personal/:legajo", modiPersonalVacaciones);
router.put("/derechos/:id", ajustarDerecho);

// Pedido y tramos
router.post("/preparar", prepararPedido);
router.post("/tramos", registrarTramo);
router.post("/tramos/:id/autorizar", aprobarTramo);
router.post("/tramos/:id/cancelar", cancelarTramo);
router.post("/tramos/:id/interrupciones", registrarInterrupcion);
router.post("/interrupciones/:id/validar", validarInterrupcion);

// Datos de una persona
router.get("/:legajo/pedido", getDatosPedido);
router.get("/:legajo/tramos", getTramosVacaciones);
router.get("/:legajo/historia", getHistoriaVacaciones);

export default router;
