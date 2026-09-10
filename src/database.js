import {config} from './config/db.config.js';
import mysql from 'mysql2/promise';

//creamos y devolvemos una coneccion a db
//console.log(config)
export const connect = async ()=>{
   return await mysql.createConnection(config);
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
