const pool = require('../config/db');

const TTL_MS = 60 * 1000;
let cache = { defaults: null, expiresAt: 0 };

function esVerdadero(valor) {
  return valor === '1' || valor.toLowerCase() === 'true';
}

async function getDefaults() {
  if (cache.defaults && Date.now() < cache.expiresAt) {
    return cache.defaults;
  }

  const [rows] = await pool.query(
    `SELECT llave, valor FROM configuracion
     WHERE categoria = 'confPropinas' AND llave IN ('ESTADO', 'PORCENTAJE_PROPINA') AND estacionid IS NULL`
  );

  const porLlave = Object.fromEntries(rows.map((r) => [r.llave, r.valor]));
  const defaults = {
    propina: esVerdadero(porLlave.ESTADO || ''),
    ppropina: Number(porLlave.PORCENTAJE_PROPINA || 0),
  };

  cache = { defaults, expiresAt: Date.now() + TTL_MS };
  return defaults;
}

module.exports = { getDefaults };
