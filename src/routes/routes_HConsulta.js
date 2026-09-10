import {Router} from 'express'
import { traerConsultaDocente, traerHconsuControl, traerHconsuControlPorPersona } from '../controllers/controllers_HConsultas.js'


const router = Router()
router.get('/controlhc_dia', traerHconsuControl)
router.get('/controlhc_dia_legajo', traerHconsuControlPorPersona)
router.get('/consuagente/:legajo',traerConsultaDocente)

export default router
