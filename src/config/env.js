import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Carga el .env por ruta absoluta anclada a la raíz del proyecto (dos niveles
// arriba de src/config/), en vez de depender de process.cwd(). Así funciona
// igual sea que el proceso se arranque con `npm run dev`, `node src/index.js`
// desde otra carpeta, systemd, pm2, etc.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
