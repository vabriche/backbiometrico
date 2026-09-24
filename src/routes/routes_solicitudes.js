import { Router } from 'express';
import {
    crearSolicitudJustificacion,
    actualizarSolicitudJustificacion,
    subirDocumentoSolicitud,
    getSolicitudesPendientes,
    gestionarSolicitudJustificacion,
} from '../controllers/controllers_solicitudes.js';

const router = Router();

router.get('/pendientes', getSolicitudesPendientes);
router.post('/justificacion', crearSolicitudJustificacion);
router.put('/justificacion/:id', actualizarSolicitudJustificacion);
router.post('/justificacion/:id/gestionar', gestionarSolicitudJustificacion);
router.post('/justificacion/:id/documento', subirDocumentoSolicitud);

export default router;
