const pool = require('../config/db');
const cuentasService = require('./cuentas');

async function restaurantes() {
  const [rows] = await pool.query('SELECT restauranteid, restaurante FROM restaurantes ORDER BY restaurante');
  return rows;
}

async function meseros() {
  const [rows] = await pool.query('SELECT usuarioid, usuario FROM usuarios WHERE estado = 1 ORDER BY usuario');
  return rows;
}

async function ventasPorMesero({ desde, hasta, restauranteid, usuarioid }) {
  const [rows] = await pool.query(
    `SELECT u.usuarioid, u.usuario,
            COALESCE(SUM(t.total_venta), 0) AS total_vendido,
            COALESCE(SUM(CASE WHEN cm.propina = 1 THEN t.total_venta * cm.ppropina / 100 ELSE 0 END), 0) AS total_propinas
     FROM usuarios u
     LEFT JOIN reservamesa rm ON rm.usuarioid = u.usuarioid
     LEFT JOIN mesas me ON me.mesaid = rm.mesaid
     LEFT JOIN zonas z ON z.zonaid = me.zonaid
     LEFT JOIN cuentamesa cm ON cm.reservaid = rm.reservaid
     LEFT JOIN (
       SELECT dp.cuentamesaid,
              SUM(CASE WHEN dp.cortesia = 0 THEN dp.precio * dp.cantidad ELSE 0 END) AS total_venta
       FROM detallepedido dp
       JOIN pedidosmesa pm ON pm.pedidomesaid = dp.pedidomesaid
       WHERE dp.cancelado = 0 AND dp.padre_detallepedidoid IS NULL AND DATE(pm.fecha) BETWEEN :desde AND :hasta
       GROUP BY dp.cuentamesaid
     ) t ON t.cuentamesaid = cm.cuentamesaid
     WHERE u.estado = 1
       AND (:restauranteid IS NULL OR z.restauranteid = :restauranteid)
       AND (:usuarioid IS NULL OR u.usuarioid = :usuarioid)
     GROUP BY u.usuarioid, u.usuario
     ORDER BY total_vendido DESC`,
    { desde, hasta, restauranteid, usuarioid }
  );
  return rows;
}

async function ventasPorCategoria({ desde, hasta, restauranteid, usuarioid }) {
  const [rows] = await pool.query(
    `SELECT c.categoriaid, c.categoria,
            SUM(dp.cantidad) AS unidades,
            SUM(CASE WHEN dp.cortesia = 0 THEN dp.precio * dp.cantidad ELSE 0 END) AS total_vendido
     FROM detallepedido dp
     JOIN pedidosmesa pm ON pm.pedidomesaid = dp.pedidomesaid
     JOIN productos p ON p.productoid = dp.productoid
     JOIN categoriasproductos c ON c.categoriaid = p.categoriaid
     JOIN cuentamesa cm ON cm.cuentamesaid = dp.cuentamesaid
     JOIN reservamesa rm ON rm.reservaid = cm.reservaid
     JOIN mesas me ON me.mesaid = rm.mesaid
     JOIN zonas z ON z.zonaid = me.zonaid
     WHERE dp.cancelado = 0 AND dp.padre_detallepedidoid IS NULL AND DATE(pm.fecha) BETWEEN :desde AND :hasta
       AND (:restauranteid IS NULL OR z.restauranteid = :restauranteid)
       AND (:usuarioid IS NULL OR rm.usuarioid = :usuarioid)
     GROUP BY c.categoriaid, c.categoria
     ORDER BY total_vendido DESC`,
    { desde, hasta, restauranteid, usuarioid }
  );
  return rows;
}

async function productosVendidos({ desde, hasta, restauranteid, usuarioid }) {
  const [rows] = await pool.query(
    `SELECT p.productoid, p.producto, c.categoria, v.unidades, v.total_vendido
     FROM productos p
     JOIN categoriasproductos c ON c.categoriaid = p.categoriaid
     JOIN (
       SELECT dp.productoid,
              SUM(dp.cantidad) AS unidades,
              SUM(CASE WHEN dp.cortesia = 0 THEN dp.precio * dp.cantidad ELSE 0 END) AS total_vendido
       FROM detallepedido dp
       JOIN pedidosmesa pm ON pm.pedidomesaid = dp.pedidomesaid
       JOIN cuentamesa cm ON cm.cuentamesaid = dp.cuentamesaid
       JOIN reservamesa rm ON rm.reservaid = cm.reservaid
       JOIN mesas me ON me.mesaid = rm.mesaid
       JOIN zonas z ON z.zonaid = me.zonaid
       WHERE dp.cancelado = 0 AND dp.padre_detallepedidoid IS NULL AND DATE(pm.fecha) BETWEEN :desde AND :hasta
         AND (:restauranteid IS NULL OR z.restauranteid = :restauranteid)
         AND (:usuarioid IS NULL OR rm.usuarioid = :usuarioid)
       GROUP BY dp.productoid
       HAVING SUM(dp.cantidad) > 0
     ) v ON v.productoid = p.productoid
     WHERE p.activo = 1
     ORDER BY c.categoria ASC, v.unidades DESC`,
    { desde, hasta, restauranteid, usuarioid }
  );
  return rows;
}

async function productosSinVentas({ desde, hasta, restauranteid, usuarioid }) {
  const [rows] = await pool.query(
    `SELECT p.productoid, p.producto, c.categoria
     FROM productos p
     JOIN categoriasproductos c ON c.categoriaid = p.categoriaid
     WHERE p.activo = 1
       AND p.productoid NOT IN (
         SELECT dp.productoid
         FROM detallepedido dp
         JOIN pedidosmesa pm ON pm.pedidomesaid = dp.pedidomesaid
         JOIN cuentamesa cm ON cm.cuentamesaid = dp.cuentamesaid
         JOIN reservamesa rm ON rm.reservaid = cm.reservaid
         JOIN mesas me ON me.mesaid = rm.mesaid
         JOIN zonas z ON z.zonaid = me.zonaid
         WHERE dp.cancelado = 0 AND dp.padre_detallepedidoid IS NULL AND DATE(pm.fecha) BETWEEN :desde AND :hasta
           AND (:restauranteid IS NULL OR z.restauranteid = :restauranteid)
           AND (:usuarioid IS NULL OR rm.usuarioid = :usuarioid)
       )
     ORDER BY c.categoria ASC, p.producto ASC`,
    { desde, hasta, restauranteid, usuarioid }
  );
  return rows;
}

async function cancelaciones({ desde, hasta, restauranteid, usuarioid }) {
  const [rows] = await pool.query(
    `SELECT dp.detallepedidoid, pm.fecha, pm.nopedido, p.producto, dp.cantidad, dp.precio,
            cm.nombrecuenta, me.nomesa, z.zona, u.usuario AS mesero
     FROM detallepedido dp
     JOIN pedidosmesa pm ON pm.pedidomesaid = dp.pedidomesaid
     JOIN productos p ON p.productoid = dp.productoid
     JOIN cuentamesa cm ON cm.cuentamesaid = dp.cuentamesaid
     JOIN reservamesa rm ON rm.reservaid = cm.reservaid
     JOIN mesas me ON me.mesaid = rm.mesaid
     JOIN zonas z ON z.zonaid = me.zonaid
     JOIN usuarios u ON u.usuarioid = rm.usuarioid
     WHERE dp.cancelado = 1 AND dp.padre_detallepedidoid IS NULL AND DATE(pm.fecha) BETWEEN :desde AND :hasta
       AND (:restauranteid IS NULL OR z.restauranteid = :restauranteid)
       AND (:usuarioid IS NULL OR rm.usuarioid = :usuarioid)
     ORDER BY pm.fecha DESC`,
    { desde, hasta, restauranteid, usuarioid }
  );
  return rows;
}

async function mesasEliminadas({ desde, hasta, restauranteid, usuarioid }) {
  const [rows] = await pool.query(
    `SELECT rm.reservaid, m.nomesa, z.zona, u.usuario AS mesero, rm.fecha, rm.razon
     FROM reservamesa rm
     JOIN mesas m ON m.mesaid = rm.mesaid
     JOIN zonas z ON z.zonaid = m.zonaid
     JOIN usuarios u ON u.usuarioid = rm.usuarioid
     WHERE rm.eliminada = 1 AND DATE(rm.fecha) BETWEEN :desde AND :hasta
       AND (:restauranteid IS NULL OR z.restauranteid = :restauranteid)
       AND (:usuarioid IS NULL OR rm.usuarioid = :usuarioid)
     ORDER BY rm.fecha DESC`,
    { desde, hasta, restauranteid, usuarioid }
  );
  return rows;
}

async function previewReserva(reservaid) {
  const [[reserva]] = await pool.query(
    `SELECT rm.reservaid, m.nomesa, z.zona, u.usuario AS mesero, rm.fecha, rm.razon
     FROM reservamesa rm
     JOIN mesas m ON m.mesaid = rm.mesaid
     JOIN zonas z ON z.zonaid = m.zonaid
     JOIN usuarios u ON u.usuarioid = rm.usuarioid
     WHERE rm.reservaid = :reservaid`,
    { reservaid }
  );
  if (!reserva) return null;

  const [cuentasBase] = await pool.query(
    'SELECT cuentamesaid, nombrecuenta FROM cuentamesa WHERE reservaid = :reservaid ORDER BY cuentamesaid',
    { reservaid }
  );
  const cuentas = await Promise.all(
    cuentasBase.map(async (c) => ({ ...c, pedido: await cuentasService.detalle(c.cuentamesaid) }))
  );

  return { reserva, cuentas };
}

module.exports = {
  restaurantes,
  meseros,
  ventasPorMesero,
  ventasPorCategoria,
  productosVendidos,
  productosSinVentas,
  cancelaciones,
  mesasEliminadas,
  previewReserva,
};
