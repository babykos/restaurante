const pool = require('../config/db');
const { getDefaults } = require('./propinas');

async function mapaDeMesas() {
  const [rows] = await pool.query(
    `SELECT m.mesaid, m.nomesa, m.zonaid, z.zona, z.hex, m.reservaidasignada,
            rm.usuarioid AS duenoid, u.usuario AS dueno,
            GROUP_CONCAT(cm.nombrecuenta ORDER BY cm.cuentamesaid SEPARATOR ', ') AS cuentas
     FROM mesas m
     JOIN zonas z ON z.zonaid = m.zonaid
     LEFT JOIN reservamesa rm ON rm.reservaid = m.reservaidasignada
     LEFT JOIN usuarios u ON u.usuarioid = rm.usuarioid
     LEFT JOIN cuentamesa cm ON cm.reservaid = rm.reservaid AND cm.inactiva = 0
     WHERE m.activa = 1 AND z.activa = 1
     GROUP BY m.mesaid, m.nomesa, m.zonaid, z.zona, z.hex, m.reservaidasignada, rm.usuarioid, u.usuario
     ORDER BY z.zona, m.nomesa`
  );
  return rows;
}

async function cuentasDeMesa(mesaid) {
  const [rows] = await pool.query(
    `SELECT cm.cuentamesaid, cm.nombrecuenta, cm.inactiva, cm.enviadacaja, cm.nodocumento,
            rm.reservaid, rm.usuarioid AS duenoid
     FROM mesas m
     JOIN reservamesa rm ON rm.reservaid = m.reservaidasignada
     JOIN cuentamesa cm ON cm.reservaid = rm.reservaid
     WHERE m.mesaid = :mesaid AND cm.inactiva = 0
     ORDER BY cm.cuentamesaid`,
    { mesaid }
  );
  return rows;
}

async function contextoMesa(mesaid) {
  const [rows] = await pool.query(
    `SELECT m.mesaid, m.nomesa, z.zona, m.reservaidasignada AS reservaid,
            rm.usuarioid AS duenoid, u.usuario AS dueno
     FROM mesas m
     JOIN zonas z ON z.zonaid = m.zonaid
     LEFT JOIN reservamesa rm ON rm.reservaid = m.reservaidasignada
     LEFT JOIN usuarios u ON u.usuarioid = rm.usuarioid
     WHERE m.mesaid = :mesaid`,
    { mesaid }
  );
  return rows.length ? rows[0] : null;
}

async function duenoDeMesa(mesaid) {
  const [rows] = await pool.query(
    `SELECT rm.usuarioid AS duenoid
     FROM mesas m
     JOIN reservamesa rm ON rm.reservaid = m.reservaidasignada
     WHERE m.mesaid = :mesaid`,
    { mesaid }
  );
  return rows.length ? rows[0].duenoid : null;
}

async function abrirMesa(mesaid, usuarioid, nombrecuenta) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[mesa]] = await conn.query(
      'SELECT mesaid, reservaidasignada FROM mesas WHERE mesaid = :mesaid FOR UPDATE',
      { mesaid }
    );
    if (!mesa) {
      throw Object.assign(new Error('Mesa no existe'), { status: 404 });
    }

    let reservaid = mesa.reservaidasignada;

    if (!reservaid) {
      const [ins] = await conn.query(
        'INSERT INTO reservamesa (usuarioid, mesaid, fecha, eliminada) VALUES (:usuarioid, :mesaid, NOW(), 0)',
        { usuarioid, mesaid }
      );
      reservaid = ins.insertId;
      await conn.query('UPDATE mesas SET reservaidasignada = :reservaid WHERE mesaid = :mesaid', {
        reservaid,
        mesaid,
      });
    } else {
      const [[reserva]] = await conn.query(
        'SELECT usuarioid FROM reservamesa WHERE reservaid = :reservaid',
        { reservaid }
      );
      if (reserva.usuarioid !== usuarioid) {
        throw Object.assign(new Error('Mesa ocupada por otro mesero'), { status: 409 });
      }
    }

    const { propina, ppropina } = await getDefaults();

    const [insCuenta] = await conn.query(
      `INSERT INTO cuentamesa (reservaid, nombrecuenta, inactiva, propina, ppropina, enviadacaja, creacion)
       VALUES (:reservaid, :nombrecuenta, 0, :propina, :ppropina, 0, NOW())`,
      { reservaid, nombrecuenta, propina: propina ? 1 : 0, ppropina }
    );

    await conn.commit();
    return insCuenta.insertId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function abrirSubcuenta(mesaid, nombrecuenta) {
  const [[mesa]] = await pool.query('SELECT reservaidasignada FROM mesas WHERE mesaid = :mesaid', {
    mesaid,
  });
  if (!mesa || !mesa.reservaidasignada) {
    throw Object.assign(new Error('La mesa no tiene una reserva activa'), { status: 400 });
  }

  const { propina, ppropina } = await getDefaults();

  const [insCuenta] = await pool.query(
    `INSERT INTO cuentamesa (reservaid, nombrecuenta, inactiva, propina, ppropina, enviadacaja, creacion)
     VALUES (:reservaid, :nombrecuenta, 0, :propina, :ppropina, 0, NOW())`,
    { reservaid: mesa.reservaidasignada, nombrecuenta, propina: propina ? 1 : 0, ppropina }
  );

  return insCuenta.insertId;
}

module.exports = {
  mapaDeMesas,
  cuentasDeMesa,
  contextoMesa,
  duenoDeMesa,
  abrirMesa,
  abrirSubcuenta,
};
