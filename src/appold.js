
import './config/env.js';
import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import routes_cargos from './routes/routes_cargos.js'
import routes_bio from './routes/routes_bio.js';
import routes_hcd from './routes/routes_hcd.js'
import routes_csr from './routes/routes_dConsulta.js'
import router_per from './routes/routes_perConsulta.js'
import routerHControl from './routes/routes_HConsulta.js'
import routes_solicitudes from './routes/routes_solicitudes.js'
import routes_partesMedicos from './routes/routes_partesMedicos.js'
import { verifyTokenWrites } from './midlewares/auth.js';
import { getAgenteLogin, getAgenteFirebaseLogin } from './controllers/controllers_bio.js';

const app = express();
app.set('port',process.env.PORTSERVER || 4000 );
//const PORT = rocess.env.PORT || 5000

//midlewares
app.use(morgan("dev"));



app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//ruta publica de login
app.post('/biometrico/login', getAgenteLogin);
app.post('/biometrico/login-firebase', getAgenteFirebaseLogin);

//a partir de aca, las rutas de escritura (POST/PUT/PATCH/DELETE) exigen JWT; los GET quedan libres

//app.use(verifyTokenWrites);
//routes
app.use('/biometrico', routes_bio);
app.use('/hcd', routes_hcd);
app.use('/cargos', routes_cargos);
app.use('/consultasr', routes_csr)
app.use('/consuper', router_per)
app.use('/hcontrol', routerHControl)
app.use('/solicitudes', routes_solicitudes)
app.use('/partesmedicos', routes_partesMedicos)



export default app;