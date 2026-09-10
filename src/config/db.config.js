
import 'dotenv/config';

export const config = {
   host: process.env.HOST,
   user: process.env.USER,
   password: process.env.PASSWORD,
   database: process.env.DB,
   port: Number(process.env.PORT || 3306)
};