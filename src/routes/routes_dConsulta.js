import {Router} from 'express'
import { getCargosVigentesReport, getFuncionesCriticas, getTipoCargo } from '../controllers/controllers_dConsultas.js'


const router = Router()

router.get('/portipocargo/:tipocargo', getTipoCargo)
router.get('/cargosvigentesreport/:sede/:claustro/:tipoc/:adicional', getCargosVigentesReport)
router.get('/funcionesCriticasVigentes', getFuncionesCriticas)


export default router
