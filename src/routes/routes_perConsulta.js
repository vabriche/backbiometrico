import {Router} from 'express'
import { traerHorasTotalesfechas, traerHorasTothorasP } from '../controllers/controllers_perConsultas.js'


const router = Router()


router.get('/asistenciatotfechas/:condicion/:fechaInicio/:fechaFin',traerHorasTotalesfechas)
router.get('/reporteasistencia_dochp',traerHorasTothorasP )

export default router
