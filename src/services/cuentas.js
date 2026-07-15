const pool = require('../config/db');
const { obtenerPrecioImpuesto } = require('./productos');

async function contexto(cuentamesaid) {
  const [rows] = await pool.query(
    `SELECT cm.cuentamesaid, cm.nombrecuenta, cm.inactiva, cm.enviadacaja, cm.nodocumento, cm.propina, cm.ppropina,
            rm.reservaid, rm.usuarioid AS duenoid, rm.mesaid, me.nomesa, z.zonaid, z.zona, z.restauranteid
     FROM cuentamesa cm
     JOIN reservamesa rm ON rm.reservaid = cm.reservaid
     JOIN mesas me ON me.mesaid = rm.mesaid
     JOIN zonas z ON z.zonaid = me.zonaid
     WHERE cm.cuentamesaid = :cuentamesaid`,
    { cuentamesaid }
  );
  return rows.length ? rows[0] : null;
}

async function detalle(cuentamesaid) {
  const [lineas] = await pool.query(
    `SELECT dp.detallepedidoid, dp.productoid, pr.producto, dp.cantidad, dp.descripcion,
            dp.cancelado, dp.cortesia, dp.precio, dp.porcentajeisv, dp.padre_detallepedidoid,
            p.pedidomesaid, p.nopedido, p.fecha, p.comentarios, p.llevar
     FROM detallepedido dp
     JOIN pedidosmesa p ON p.pedidomesaid = dp.pedidomesaid
     JOIN productos pr ON pr.productoid = dp.productoid
     WHERE dp.cuentamesaid = :cuentamesaid AND dp.cancelado = 0
     ORDER BY p.nopedido, dp.detallepedidoid`,
    { cuentamesaid }
  );

  let subtotal = 0;
  let impuesto = 0;
  for (const l of lineas) {
    if (l.cortesia) continue;
    const base = l.precio * l.cantidad;
    subtotal += base;
    impuesto += (base * l.porcentajeisv) / 100;
  }

  return { lineas, subtotal, impuesto, total: subtotal + impuesto };
}

async function crearPedido(cuentamesaid, reservaid, { items, comentarios = '', llevar = false }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[fila]] = await conn.query(
      `SELECT IFNULL(MAX(nopedido), 0) + 1 AS siguiente
       FROM pedidosmesa
       WHERE DATE(fecha) = CURDATE()
       FOR UPDATE`
    );
    const nopedido = fila.siguiente;

    const [insPedido] = await conn.query(
      `INSERT INTO pedidosmesa (fecha, reservaid, nopedido, comentarios, llevar)
       VALUES (NOW(), :reservaid, :nopedido, :comentarios, :llevar)`,
      { reservaid, nopedido, comentarios, llevar: llevar ? 1 : 0 }
    );
    const pedidomesaid = insPedido.insertId;

    for (const item of items) {
      const datos = await obtenerPrecioImpuesto(item.productoid);
      if (!datos) {
        throw Object.assign(new Error(`Producto ${item.productoid} no existe o está inactivo`), {
          status: 400,
        });
      }
      await conn.query(
        `INSERT INTO detallepedido
           (pedidomesaid, productoid, cantidad, descripcion, cancelado, cortesia, cuentamesaid, precio, porcentajeisv)
         VALUES (:pedidomesaid, :productoid, :cantidad, :descripcion, 0, 0, :cuentamesaid, :precio, :porcentajeisv)`,
        {
          pedidomesaid,
          productoid: item.productoid,
          cantidad: item.cantidad,
          descripcion: item.descripcion || '',
          cuentamesaid,
          precio: datos.precioventa,
          porcentajeisv: datos.porcentajeisv,
        }
      );
    }

    await conn.commit();
    return pedidomesaid;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function insertarComando(comando, parametro, restauranteid) {
  await pool.query(
    `INSERT INTO comandos (comando, parametro, ejecutado, fecha, parametro2)
     VALUES (:comando, :parametro, 0, NOW(), :parametro2)`,
    { comando, parametro, parametro2: restauranteid }
  );
}

async function enviarComandaCocina(pedidomesaid, restauranteid) {
  await insertarComando('IMPRESION_COMANDA', pedidomesaid, restauranteid);
}

async function generarProforma(cuentamesaid, restauranteid) {
  await insertarComando('GENERAR_PROFORMA', cuentamesaid, restauranteid);
}

async function enviarACaja(cuentamesaid) {
  const { total } = await detalle(cuentamesaid);
  if (total <= 0) {
    throw Object.assign(new Error('No puede enviar a caja cuentas en cero'), { status: 400 });
  }
  await pool.query('UPDATE cuentamesa SET enviadacaja = 1 WHERE cuentamesaid = :cuentamesaid', {
    cuentamesaid,
  });
}

module.exports = {
  contexto,
  detalle,
  crearPedido,
  enviarComandaCocina,
  generarProforma,
  enviarACaja,
};
