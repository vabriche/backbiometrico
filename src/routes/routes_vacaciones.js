import { Router } from "express";
import {
  getAgentesVacaciones,
  getPersonalVacaciones,
  generarReconocimientos,
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
  getTramosVacaciones,
  getHistoriaVacaciones,
  prepararPedido,
  registrarTramo,
  aprobarTramo,
  rechazarTramo,
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
} from "../controllers/controllers_vacaciones.js";

// Licencia anual ordinaria (vacaciones). Ver sql/licencia_anual.sql.
const router = Router();

// App del empleado: el legajo sale del token (soloEmpleado pisa cualquier legajo recibido)
router.get("/empleado/resumen", getResumenEmpleado);
router.post("/empleado/preparar", soloEmpleado, prepararPedido);
router.post("/empleado/tramos", soloEmpleado, registrarTramo);
router.get("/empleado/tramos", soloEmpleado, getTramosVacaciones);

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
router.post("/personal/reconocimientos", generarReconocimientos);
router.put("/personal/:legajo", modiPersonalVacaciones);
router.put("/derechos/:id", ajustarDerecho);

// Pedido y tramos
router.post("/preparar", prepararPedido);
router.post("/tramos", registrarTramo);
router.post("/tramos/:id/autorizar", aprobarTramo);
router.post("/tramos/:id/rechazar", rechazarTramo);
router.post("/tramos/:id/cancelar", cancelarTramo);
router.post("/tramos/:id/interrupciones", registrarInterrupcion);
router.post("/interrupciones/:id/validar", validarInterrupcion);

// Datos de una persona
router.get("/:legajo/pedido", getDatosPedido);
router.get("/:legajo/tramos", getTramosVacaciones);
router.get("/:legajo/historia", getHistoriaVacaciones);

export default router;
