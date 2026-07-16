require('dotenv').config();
const crypto = require('crypto');
const pool = require('./src/config/db');
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
(async () => {
  const [ins] = await pool.query(
    'INSERT INTO usuarios (usuario, clave, perfilid, estado) VALUES (?, ?, 6, 1)',
    ['_E2E_CHECK_', md5('test123')]
  );
  console.log('usuarioid:', ins.insertId);
  process.exit(0);
})();
