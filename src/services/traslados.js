const pool = require('../config/db');

async function usuariosActivos(excluirId) {
  const [rows] = await pool.query(
    'SELECT usuarioid, usuario FROM usuarios WHERE estado = 1 AND usuarioid != :excluirId ORDER BY usuario',
    { excluirId }
  );
  return rows;
}

async function solicitarTraslado(reservaid, solicitaId, recibeId) {
  await pool.query(
    `INSERT INTO trasladocuenta (solicita, recibe, fechasolicita, fecharecibe, reservaid)
     VALUES (:solicitaId, :recibeId, NOW(), NULL, :reservaid)`,
    { solicitaId, recibeId, reservaid }
  );
}

async function pendientesRecibidos(usuarioid) {
  const [rows] = await pool.query(
    `SELECT tc.trasladoid, tc.fechasolicita, tc.reservaid, m.nomesa, z.zona, u.usuario AS solicitante
     FROM trasladocuenta tc
     JOIN reservamesa rm ON rm.reservaid = tc.reservaid
     JOIN mesas m ON m.mesaid = rm.mesaid
     JOIN zonas z ON z.zonaid = m.zonaid
     JOIN usuarios u ON u.usuarioid = tc.solicita
     WHERE tc.recibe = :usuarioid AND tc.fecharecibe IS NULL
     ORDER BY tc.fechasolicita DESC`,
    { usuarioid }
  );
  return rows;
}

async function pendientesEnviados(usuarioid) {
  const [rows] = await pool.query(
    `SELECT tc.trasladoid, tc.fechasolicita, tc.reservaid, m.nomesa, z.zona, u.usuario AS destino
     FROM trasladocuenta tc
     JOIN reservamesa rm ON rm.reservaid = tc.reservaid
     JOIN mesas m ON m.mesaid = rm.mesaid
     JOIN zonas z ON z.zonaid = m.zonaid
     JOIN usuarios u ON u.usuarioid = tc.recibe
     WHERE tc.solicita = :usuarioid AND tc.fecharecibe IS NULL
     ORDER BY tc.fechasolicita DESC`,
    { usuarioid }
  );
  return rows;
}

async function contarPendientesRecibidos(usuarioid) {
  const [[fila]] = await pool.query(
    'SELECT COUNT(*) AS n FROM trasladocuenta WHERE recibe = :usuarioid AND fecharecibe IS NULL',
    { usuarioid }
  );
  return fila.n;
}

async function aceptarTraslado(trasladoid, usuarioid) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[traslado]] = await conn.query(
      'SELECT reservaid, recibe, fecharecibe FROM trasladocuenta WHERE trasladoid = :trasladoid FOR UPDATE',
      { trasladoid }
    );
    if (!traslado) {
      throw Object.assign(new Error('Traslado no existe'), { status: 404 });
    }
    if (traslado.recibe !== usuarioid) {
      throw Object.assign(new Error('No autorizado'), { status: 403 });
    }
    if (traslado.fecharecibe) {
      throw Object.assign(new Error('Este traslado ya fue procesado'), { status: 400 });
    }

    await conn.query('UPDATE trasladocuenta SET fecharecibe = NOW() WHERE trasladoid = :trasladoid', {
      trasladoid,
    });
    await conn.query('UPDATE reservamesa SET usuarioid = :usuarioid WHERE reservaid = :reservaid', {
      usuarioid,
      reservaid: traslado.reservaid,
    });

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  usuariosActivos,
  solicitarTraslado,
  pendientesRecibidos,
  pendientesEnviados,
  contarPendientesRecibidos,
  aceptarTraslado,
};
