import {config} from './config/db.config.js';
import mysql from 'mysql2/promise';

// Pool de conexiones compartido: `connect()` antes abría una conexión MySQL
// nueva por cada consulta (mysql.createConnection) y casi ningún controlador
// la cerraba, así que se iban acumulando hasta agotar max_connections del
// servidor ("Too many connections"). Con un pool, cada `db.query(...)`
// toma prestada una conexión y la devuelve sola al terminar — no hace falta
// (ni corresponde) llamar a `.end()` después de cada consulta.
const pool = mysql.createPool({
   ...config,
   waitForConnections: true,
   connectionLimit: 10,
   queueLimit: 0,
});

export const connect = async ()=>{
   return pool;
};
/*
// prueba de coneccion

export const connect = async () => {
    const conn = await mysql.createConnection(config);
    const [rows] = await conn.query('SELECT 1 + 1');
    console.log(rows);

}
connect();

*/
