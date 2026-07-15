const pool = require('../config/db');

const TTL_MS = 60 * 1000;
let cache = { perfilesAdmin: null, expiresAt: 0 };

async function getPerfilesAdministrador() {
  if (cache.perfilesAdmin && Date.now() < cache.expiresAt) {
    return cache.perfilesAdmin;
  }

  const [rows] = await pool.query(
    `SELECT ids FROM configuracion
     WHERE categoria = 'confRestaurante' AND llave = 'PERFIL_ADMINISTRADOR' AND estacionid IS NULL
     LIMIT 1`
  );

  const ids = rows.length ? rows[0].ids || '' : '';
  const perfilesAdmin = ids
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map(Number);

  cache = { perfilesAdmin, expiresAt: Date.now() + TTL_MS };
  return perfilesAdmin;
}

async function resolveRol(perfilid) {
  const perfilesAdmin = await getPerfilesAdministrador();
  return perfilesAdmin.includes(Number(perfilid)) ? 'encargado' : 'mesero';
}

module.exports = { resolveRol };
