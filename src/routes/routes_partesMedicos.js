import { Router } from "express";
import {
  importarPartesMedicos,
  uploadExcelPartesMedicos,
  getPartesMedicosTodos,
  getPartesMedicosPorLegajo,
  actualizarRegistroParte,
  gestionarParte,
  subirDocumentoParte,
} from "../controllers/controllers_partesMedicos.js";

const router = Router();

// Recibe el Excel de partes médicos subido desde la PC (campo "archivo") y lo importa
router.post("/importar", uploadExcelPartesMedicos, importarPartesMedicos);

// Todos los partes médicos (el filtrado por estado/registrado/motivo se hace en el frontend)
router.get("/todos", getPartesMedicosTodos);

// Partes médicos de un legajo puntual
router.get("/:legajo", getPartesMedicosPorLegajo);

// Marcar un parte como anulado o ya registrado en inasistencia
router.put("/:codParte/registro", actualizarRegistroParte);

// Crear/completar la inasistencia del parte (transacción) y actualizar su registrado
router.post("/:codParte/gestionar", gestionarParte);

// Subir el documento (certificado) asociado a un parte médico
router.post("/:codParte/documento", subirDocumentoParte);

export default router;
