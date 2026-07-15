const pool = require('../config/db');

async function catalogo() {
  const [rows] = await pool.query(
    `SELECT p.productoid, p.producto, p.precioventa, p.categoriaid, c.categoria,
            COALESCE(i.porcentaje, 0) AS porcentajeisv
     FROM productos p
     JOIN categoriasproductos c ON c.categoriaid = p.categoriaid
     LEFT JOIN impuestos i ON i.impuestoid = p.impuestoid
     WHERE p.activo = 1 AND c.publicado = 1
     ORDER BY c.orden, c.categoria, p.producto`
  );
  return rows;
}

async function obtenerPrecioImpuesto(productoid) {
  const [rows] = await pool.query(
    `SELECT p.precioventa, COALESCE(i.porcentaje, 0) AS porcentajeisv
     FROM productos p
     LEFT JOIN impuestos i ON i.impuestoid = p.impuestoid
     WHERE p.productoid = :productoid AND p.activo = 1`,
    { productoid }
  );
  return rows.length ? rows[0] : null;
}

module.exports = { catalogo, obtenerPrecioImpuesto };
