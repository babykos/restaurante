const pool = require('../config/db');
const { RESTAURANTEID } = require('../config/restaurante');

async function estaciones() {
  const [rows] = await pool.query('SELECT zonaid, zona FROM zonasdeimpresion ORDER BY zona');
  return rows;
}

async function estacion(zonaid) {
  const [rows] = await pool.query('SELECT zonaid, zona FROM zonasdeimpresion WHERE zonaid = :zonaid', { zonaid });
  return rows.length ? rows[0] : null;
}

async function pedidosPendientes(zonaid) {
  const [filas] = await pool.query(
    `SELECT dp.pedidomesaid, pm.nopedido, pm.fecha, pm.comentarios, pm.llevar,
            m.nomesa, u.usuario AS mesero,
            dp.detallepedidoid, dp.productoid, pr.producto, dp.cantidad, dp.descripcion, dp.cortesia
     FROM detallepedido dp
     JOIN pedidosmesa pm ON pm.pedidomesaid = dp.pedidomesaid
     JOIN productos pr ON pr.productoid = dp.productoid
     JOIN cuentamesa cm ON cm.cuentamesaid = dp.cuentamesaid
     JOIN reservamesa rm ON rm.reservaid = cm.reservaid
     JOIN mesas m ON m.mesaid = rm.mesaid
     JOIN zonas z ON z.zonaid = m.zonaid
     JOIN usuarios u ON u.usuarioid = rm.usuarioid
     LEFT JOIN kds kl ON kl.pedidomesaid = dp.pedidomesaid AND kl.zonaid = pr.zonaid
     WHERE pr.zonaid = :zonaid AND dp.cancelado = 0 AND dp.padre_detallepedidoid IS NULL
       AND z.restauranteid = :restauranteid
       AND kl.pedidomesaid IS NULL
     ORDER BY pm.fecha ASC, pm.nopedido ASC, dp.detallepedidoid ASC`,
    { zonaid, restauranteid: RESTAURANTEID }
  );

  const tickets = new Map();
  for (const f of filas) {
    if (!tickets.has(f.pedidomesaid)) {
      tickets.set(f.pedidomesaid, {
        pedidomesaid: f.pedidomesaid,
        nopedido: f.nopedido,
        fecha: f.fecha,
        comentarios: f.comentarios,
        llevar: Boolean(f.llevar),
        nomesa: f.nomesa,
        mesero: f.mesero,
        lineas: [],
      });
    }
    tickets.get(f.pedidomesaid).lineas.push({
      detallepedidoid: f.detallepedidoid,
      producto: f.producto,
      cantidad: f.cantidad,
      descripcion: f.descripcion,
      cortesia: Boolean(f.cortesia),
    });
  }
  return [...tickets.values()];
}

async function historico(zonaid, limite = 50) {
  const [cabeceras] = await pool.query(
    `SELECT k.pedidomesaid, k.fecha AS fecha_listo, pm.nopedido, pm.fecha, pm.comentarios, pm.llevar,
            m.nomesa, u.usuario AS mesero
     FROM kds k
     JOIN pedidosmesa pm ON pm.pedidomesaid = k.pedidomesaid
     JOIN reservamesa rm ON rm.reservaid = pm.reservaid
     JOIN mesas m ON m.mesaid = rm.mesaid
     JOIN zonas z ON z.zonaid = m.zonaid
     JOIN usuarios u ON u.usuarioid = rm.usuarioid
     WHERE k.zonaid = :zonaid AND z.restauranteid = :restauranteid
     ORDER BY k.fecha DESC
     LIMIT :limite`,
    { zonaid, restauranteid: RESTAURANTEID, limite }
  );
  if (cabeceras.length === 0) return [];

  const ids = cabeceras.map((c) => c.pedidomesaid);
  const [lineas] = await pool.query(
    `SELECT dp.pedidomesaid, dp.detallepedidoid, dp.productoid, pr.producto, dp.cantidad, dp.descripcion, dp.cortesia
     FROM detallepedido dp
     JOIN productos pr ON pr.productoid = dp.productoid
     WHERE dp.pedidomesaid IN (:ids) AND pr.zonaid = :zonaid AND dp.padre_detallepedidoid IS NULL
     ORDER BY dp.detallepedidoid ASC`,
    { ids, zonaid }
  );

  return cabeceras.map((c) => ({
    ...c,
    minutos: Math.round((new Date(c.fecha_listo).getTime() - new Date(c.fecha).getTime()) / 60000),
    lineas: lineas
      .filter((l) => l.pedidomesaid === c.pedidomesaid)
      .map((l) => ({
        detallepedidoid: l.detallepedidoid,
        producto: l.producto,
        cantidad: l.cantidad,
        descripcion: l.descripcion,
        cortesia: Boolean(l.cortesia),
      })),
  }));
}

async function marcarListo(pedidomesaid, zonaid) {
  await pool.query(
    `INSERT INTO kds (pedidomesaid, zonaid, fecha)
     SELECT :pedidomesaid, :zonaid, NOW()
     FROM pedidosmesa pm
     JOIN reservamesa rm ON rm.reservaid = pm.reservaid
     JOIN mesas m ON m.mesaid = rm.mesaid
     JOIN zonas z ON z.zonaid = m.zonaid
     WHERE pm.pedidomesaid = :pedidomesaid AND z.restauranteid = :restauranteid
     ON DUPLICATE KEY UPDATE fecha = NOW()`,
    { pedidomesaid, zonaid, restauranteid: RESTAURANTEID }
  );
}

module.exports = { estaciones, estacion, pedidosPendientes, historico, marcarListo };
