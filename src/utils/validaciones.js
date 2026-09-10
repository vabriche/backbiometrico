// utils/validaciones.js
const FORMATO_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_HORAS_JORNADA = 24;

export const validarFormatoHora = (hora) => FORMATO_HORA.test(hora);

export const calcularHorasSeguro = (he, hs) => {
  const [hh, mm] = he.split(":").map(Number);
  const [hsh, hsm] = hs.split(":").map(Number);
  const entrada = hh * 60 + mm;
  const salida = hsh * 60 + hsm;
  return (salida - entrada) / 60;
};

export const sanitizarLegajo = (valor) => {
  const n = parseInt(valor, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const validarFecha = (fecha) => {
    // Formato YYYY-MM-DD
    const regex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    if (!regex.test(fecha)) return false;
    const d = new Date(fecha);
    return !isNaN(d.getTime());
  };
  
  export const validarCondi = (condi) => ["1", "2"].includes(condi);

// Filtra un objeto (típicamente req.body) dejando solo las claves de la
// lista blanca. Se usa antes de pasar un objeto a `UPDATE tabla SET ?`:
// mysql2 escapa los VALORES de ese objeto, pero no sus CLAVES (nombres de
// columna), así que un body con una clave arbitraria podría inyectar SQL
// vía el nombre de columna si no se restringe antes a columnas conocidas.
export const filtrarColumnasPermitidas = (body, permitidas) => {
  const resultado = {};
  for (const key of Object.keys(body || {})) {
    if (permitidas.includes(key)) {
      resultado[key] = body[key];
    }
  }
  return resultado;
};