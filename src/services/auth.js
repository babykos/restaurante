const crypto = require('crypto');
const pool = require('../config/db');
const { resolveRol } = require('./roles');

function md5(texto) {
  return crypto.createHash('md5').update(texto, 'utf8').digest('hex');
}

async function autenticar(usuario, clave) {
  const [rows] = await pool.query(
    `SELECT usuarioid, usuario, perfilid FROM usuarios
     WHERE usuario = :usuario AND clave = :clave AND estado = 1
     LIMIT 1`,
    { usuario, clave: md5(clave) }
  );

  if (!rows.length) return null;

  const user = rows[0];
  const rol = await resolveRol(user.perfilid);

  return {
    usuarioid: user.usuarioid,
    usuario: user.usuario,
    perfilid: user.perfilid,
    rol,
  };
}

module.exports = { autenticar };
