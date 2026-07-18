const pool = require('../config/db');
const { obtenerPrecioImpuesto, resolverAsistente } = require('./productos');
const { RESTAURANTEID } = require('../config/restaurante');

async function contexto(cuentamesaid) {
  const [rows] = await pool.query(
    `SELECT cm.cuentamesaid, cm.nombrecuenta, cm.inactiva, cm.enviadacaja, cm.nodocumento, cm.propina, cm.ppropina,
            rm.reservaid, rm.usuarioid AS duenoid, rm.mesaid, me.nomesa, z.zonaid, z.zona, z.restauranteid
     FROM cuentamesa cm
     JOIN reservamesa rm ON rm.reservaid = cm.reservaid
     JOIN mesas me ON me.mesaid = rm.mesaid
     JOIN zonas z ON z.zonaid = me.zonaid
     WHERE cm.cuentamesaid = :cuentamesaid AND z.restauranteid = :restauranteid`,
    { cuentamesaid, restauranteid: RESTAURANTEID }
  );
  return rows.length ? rows[0] : null;
}

const SEPARADOR_NOTA = ' >> ';

function extraerNota(descripcion, producto) {
  if (!descripcion || descripcion === producto) return '';

  const prefijoNota = producto + SEPARADOR_NOTA;
  if (descripcion.startsWith(prefijoNota)) {
    return descripcion.slice(prefijoNota.length);
  }

  const prefijoAsistente = producto + ' (';
  if (descripcion.startsWith(prefijoAsistente) && descripcion.endsWith(')')) {
    return descripcion.slice(prefijoAsistente.length, -1);
  }

  return descripcion;
}

async function detalle(cuentamesaid) {
  const [lineas] = await pool.query(
    `SELECT dp.detallepedidoid, dp.productoid, pr.producto, dp.cantidad, dp.descripcion,
            dp.cancelado, dp.cortesia, dp.precio, dp.porcentajeisv, dp.padre_detallepedidoid,
            p.pedidomesaid, p.nopedido, p.fecha, p.comentarios, p.llevar
     FROM detallepedido dp
     JOIN pedidosmesa p ON p.pedidomesaid = dp.pedidomesaid
     JOIN productos pr ON pr.productoid = dp.productoid
     WHERE dp.cuentamesaid = :cuentamesaid AND dp.cancelado = 0 AND dp.padre_detallepedidoid IS NULL
     ORDER BY p.nopedido, dp.detallepedidoid`,
    { cuentamesaid }
  );

  // dp.precio ya incluye el ISV (es el precio de menú, igual que facturadet.precioconisv).
  // El total cobrado es la suma directa; subtotal/impuesto se calculan descontando
  // el ISV del precio (igual que Maverick al facturar), no sumándolo encima.
  let total = 0;
  let subtotal = 0;
  let impuesto = 0;
  for (const l of lineas) {
    l.nota = extraerNota(l.descripcion, l.producto);
    if (l.cortesia) continue;
    const totalLinea = l.precio * l.cantidad;
    const subtotalLinea = totalLinea / (1 + l.porcentajeisv / 100);
    total += totalLinea;
    subtotal += subtotalLinea;
    impuesto += totalLinea - subtotalLinea;
  }

  return { lineas, subtotal, impuesto, total };
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
      if (Array.isArray(item.opcionids) && item.opcionids.length > 0) {
        const resultado = await resolverAsistente(item.productoid, item.opcionids);

        const [insPadre] = await conn.query(
          `INSERT INTO detallepedido
             (pedidomesaid, productoid, cantidad, descripcion, cancelado, cortesia, cuentamesaid, precio, porcentajeisv)
           VALUES (:pedidomesaid, :productoid, 1, :descripcion, 0, 0, :cuentamesaid, :precio, :porcentajeisv)`,
          {
            pedidomesaid,
            productoid: item.productoid,
            descripcion: resultado.descripcion,
            cuentamesaid,
            precio: resultado.precioTotal,
            porcentajeisv: resultado.porcentajeisv,
          }
        );
        const padreDetallepedidoid = insPadre.insertId;

        for (const opcion of resultado.seleccionadas) {
          await conn.query(
            `INSERT INTO detallepedido
               (pedidomesaid, productoid, cantidad, descripcion, cancelado, cortesia, cuentamesaid, precio, porcentajeisv, padre_detallepedidoid)
             VALUES (:pedidomesaid, :productoid, 1, :descripcion, 0, 0, :cuentamesaid, :precio, :porcentajeisv, :padreDetallepedidoid)`,
            {
              pedidomesaid,
              productoid: opcion.productoid,
              descripcion: opcion.producto,
              cuentamesaid,
              precio: opcion.precioadicional,
              porcentajeisv: resultado.porcentajeisv,
              padreDetallepedidoid,
            }
          );
        }
        continue;
      }

      const datos = await obtenerPrecioImpuesto(item.productoid);
      if (!datos) {
        throw Object.assign(new Error(`Producto ${item.productoid} no existe o está inactivo`), {
          status: 400,
        });
      }
      const descripcion = item.descripcion
        ? `${datos.producto}${SEPARADOR_NOTA}${item.descripcion}`
        : datos.producto;

      await conn.query(
        `INSERT INTO detallepedido
           (pedidomesaid, productoid, cantidad, descripcion, cancelado, cortesia, cuentamesaid, precio, porcentajeisv)
         VALUES (:pedidomesaid, :productoid, :cantidad, :descripcion, 0, 0, :cuentamesaid, :precio, :porcentajeisv)`,
        {
          pedidomesaid,
          productoid: item.productoid,
          cantidad: item.cantidad,
          descripcion,
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

async function eliminarCuenta(cuentamesaid) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[cuenta]] = await conn.query(
      'SELECT reservaid FROM cuentamesa WHERE cuentamesaid = :cuentamesaid FOR UPDATE',
      { cuentamesaid }
    );
    if (!cuenta) {
      throw Object.assign(new Error('Cuenta no encontrada'), { status: 404 });
    }

    const [[productos]] = await conn.query(
      'SELECT COUNT(*) AS total FROM detallepedido WHERE cuentamesaid = :cuentamesaid AND cancelado = 0',
      { cuentamesaid }
    );
    if (productos.total > 0) {
      throw Object.assign(new Error('No se puede eliminar una cuenta con productos'), { status: 400 });
    }

    await conn.query('UPDATE cuentamesa SET inactiva = 1 WHERE cuentamesaid = :cuentamesaid', { cuentamesaid });

    const [[pendientes]] = await conn.query(
      `SELECT COUNT(*) AS total FROM cuentamesa
       WHERE reservaid = :reservaid AND inactiva = 0 AND nodocumento IS NULL`,
      { reservaid: cuenta.reservaid }
    );

    if (pendientes.total === 0) {
      await conn.query('UPDATE mesas SET reservaidasignada = NULL WHERE reservaidasignada = :reservaid', {
        reservaid: cuenta.reservaid,
      });
      await conn.query(
        `UPDATE reservamesa SET eliminada = 1, razon = 'Sin cuentas pendientes de facturar'
         WHERE reservaid = :reservaid`,
        { reservaid: cuenta.reservaid }
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function trasladarProducto(cuentamesaidOrigen, { productoid, descripcion, cantidad, destino }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[origen]] = await conn.query(
      'SELECT reservaid, inactiva, nodocumento, enviadacaja FROM cuentamesa WHERE cuentamesaid = :id FOR UPDATE',
      { id: cuentamesaidOrigen }
    );
    if (!origen) {
      throw Object.assign(new Error('Cuenta origen no encontrada'), { status: 404 });
    }
    if (origen.nodocumento || origen.inactiva === 1 || origen.enviadacaja === 1) {
      throw Object.assign(
        new Error('No puedes modificar esta cuenta, ya fue facturada, inactiva o enviada a caja'),
        { status: 400 }
      );
    }

    if (destino === cuentamesaidOrigen) {
      throw Object.assign(new Error('La cuenta destino debe ser diferente a la de origen'), { status: 400 });
    }

    const [[destinoCuenta]] = await conn.query(
      'SELECT reservaid, inactiva, nodocumento, enviadacaja FROM cuentamesa WHERE cuentamesaid = :id FOR UPDATE',
      { id: destino }
    );
    if (!destinoCuenta) {
      throw Object.assign(new Error('Cuenta destino no encontrada'), { status: 404 });
    }
    if (destinoCuenta.reservaid !== origen.reservaid) {
      throw Object.assign(new Error('La cuenta destino debe ser de la misma mesa'), { status: 400 });
    }
    if (destinoCuenta.nodocumento || destinoCuenta.inactiva === 1 || destinoCuenta.enviadacaja === 1) {
      throw Object.assign(new Error('Esta cuenta destino ya no admite cambios'), { status: 400 });
    }

    const [filas] = await conn.query(
      `SELECT detallepedidoid, cantidad, pedidomesaid, precio, porcentajeisv, padre_detallepedidoid
       FROM detallepedido
       WHERE cuentamesaid = :cuentamesaid AND productoid = :productoid
         AND LOWER(descripcion) = LOWER(:descripcion) AND cancelado = 0
       ORDER BY detallepedidoid
       FOR UPDATE`,
      { cuentamesaid: cuentamesaidOrigen, productoid, descripcion }
    );

    const disponible = filas.reduce((n, f) => n + Number(f.cantidad), 0);
    let restante = Number(cantidad);
    if (!(restante > 0) || restante > disponible) {
      throw Object.assign(new Error('No puedes trasladar mas de las unidades disponibles'), { status: 400 });
    }

    for (const fila of filas) {
      if (restante <= 0) break;

      if (Number(fila.cantidad) <= restante) {
        await conn.query('UPDATE detallepedido SET cuentamesaid = :destino, cortesia = 0 WHERE detallepedidoid = :id', {
          destino,
          id: fila.detallepedidoid,
        });
        // Si es un producto con opciones (asistente), sus hijos viajan junto con el padre.
        await conn.query('UPDATE detallepedido SET cuentamesaid = :destino WHERE padre_detallepedidoid = :id', {
          destino,
          id: fila.detallepedidoid,
        });
        restante -= Number(fila.cantidad);
      } else {
        const [[{ n }]] = await conn.query(
          'SELECT COUNT(*) AS n FROM detallepedido WHERE padre_detallepedidoid = :id',
          { id: fila.detallepedidoid }
        );
        if (n > 0) {
          throw Object.assign(
            new Error('No se puede trasladar parcialmente un producto con opciones personalizadas'),
            { status: 400 }
          );
        }

        await conn.query('UPDATE detallepedido SET cantidad = cantidad - :restante WHERE detallepedidoid = :id', {
          restante,
          id: fila.detallepedidoid,
        });
        await conn.query(
          `INSERT INTO detallepedido
             (pedidomesaid, productoid, cantidad, descripcion, cancelado, cortesia, cuentamesaid, precio, porcentajeisv, padre_detallepedidoid)
           VALUES (:pedidomesaid, :productoid, :restante, :descripcion, 0, 0, :destino, :precio, :porcentajeisv, :padre)`,
          {
            pedidomesaid: fila.pedidomesaid,
            productoid,
            restante,
            descripcion,
            destino,
            precio: fila.precio,
            porcentajeisv: fila.porcentajeisv,
            padre: fila.padre_detallepedidoid,
          }
        );
        restante = 0;
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function cancelarProducto(cuentamesaid, { productoid, descripcion, cantidad }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[cuenta]] = await conn.query(
      `SELECT cm.reservaid, cm.inactiva, cm.nodocumento, cm.enviadacaja, z.restauranteid
       FROM cuentamesa cm
       JOIN reservamesa rm ON rm.reservaid = cm.reservaid
       JOIN mesas me ON me.mesaid = rm.mesaid
       JOIN zonas z ON z.zonaid = me.zonaid
       WHERE cm.cuentamesaid = :cuentamesaid
       FOR UPDATE`,
      { cuentamesaid }
    );
    if (!cuenta) {
      throw Object.assign(new Error('Cuenta no encontrada'), { status: 404 });
    }
    if (cuenta.nodocumento || cuenta.inactiva === 1 || cuenta.enviadacaja === 1) {
      throw Object.assign(
        new Error('No puedes modificar esta cuenta, ya fue facturada, inactiva o enviada a caja'),
        { status: 400 }
      );
    }

    const [filas] = await conn.query(
      `SELECT detallepedidoid, cantidad, pedidomesaid, precio, porcentajeisv, cortesia
       FROM detallepedido
       WHERE cuentamesaid = :cuentamesaid AND productoid = :productoid
         AND LOWER(descripcion) = LOWER(:descripcion) AND cancelado = 0 AND padre_detallepedidoid IS NULL
       ORDER BY detallepedidoid
       FOR UPDATE`,
      { cuentamesaid, productoid, descripcion }
    );

    const disponible = filas.reduce((n, f) => n + Number(f.cantidad), 0);
    let restante = Number(cantidad);
    if (!(restante > 0) || restante > disponible) {
      throw Object.assign(new Error('No puedes cancelar mas de las unidades disponibles'), { status: 400 });
    }

    // Igual que PanelCuenta.CancelarPedido en Maverick: si la fila cabe completa se cancela
    // entera, si no, se resta la cantidad restante y se clona una fila nueva ya cancelada
    // con esa cantidad (para dejar registro exacto de lo cancelado).
    const idsCancelados = [];

    for (const fila of filas) {
      if (restante <= 0) break;

      if (Number(fila.cantidad) <= restante) {
        await conn.query('UPDATE detallepedido SET cancelado = 1 WHERE detallepedidoid = :id', {
          id: fila.detallepedidoid,
        });
        // Si es un producto con opciones (asistente), sus hijos se cancelan junto con el padre.
        await conn.query('UPDATE detallepedido SET cancelado = 1 WHERE padre_detallepedidoid = :id', {
          id: fila.detallepedidoid,
        });
        idsCancelados.push(fila.detallepedidoid);
        restante -= Number(fila.cantidad);
      } else {
        const [[{ n }]] = await conn.query(
          'SELECT COUNT(*) AS n FROM detallepedido WHERE padre_detallepedidoid = :id',
          { id: fila.detallepedidoid }
        );
        if (n > 0) {
          throw Object.assign(
            new Error('No se puede cancelar parcialmente un producto con opciones personalizadas'),
            { status: 400 }
          );
        }

        await conn.query('UPDATE detallepedido SET cantidad = cantidad - :restante WHERE detallepedidoid = :id', {
          restante,
          id: fila.detallepedidoid,
        });
        const [insClon] = await conn.query(
          `INSERT INTO detallepedido
             (pedidomesaid, productoid, cantidad, descripcion, cancelado, cortesia, cuentamesaid, precio, porcentajeisv)
           VALUES (:pedidomesaid, :productoid, :restante, :descripcion, 1, :cortesia, :cuentamesaid, :precio, :porcentajeisv)`,
          {
            pedidomesaid: fila.pedidomesaid,
            productoid,
            restante,
            descripcion,
            cortesia: fila.cortesia,
            cuentamesaid,
            precio: fila.precio,
            porcentajeisv: fila.porcentajeisv,
          }
        );
        idsCancelados.push(insClon.insertId);
        restante = 0;
      }
    }

    // La impresion NUNCA se hace directo: se encola en COMANDOS para que Maverick
    // (ListadoComandos.java) la procese, igual que IMPRESION_COMANDA/GENERAR_PROFORMA.
    for (const id of idsCancelados) {
      await conn.query(
        `INSERT INTO comandos (comando, parametro, ejecutado, fecha, parametro2)
         VALUES ('CANCELACION_COMANDA', :id, 0, NOW(), :restauranteid)`,
        { id, restauranteid: cuenta.restauranteid }
      );
    }

    await conn.commit();
    return idsCancelados;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function toggleEnviarACaja(cuentamesaid) {
  const [[cuenta]] = await pool.query(
    'SELECT enviadacaja, nodocumento FROM cuentamesa WHERE cuentamesaid = :cuentamesaid',
    { cuentamesaid }
  );
  if (!cuenta) {
    throw Object.assign(new Error('Cuenta no encontrada'), { status: 404 });
  }
  if (cuenta.nodocumento) {
    throw Object.assign(new Error('Esta cuenta ya fue facturada, no se puede modificar'), { status: 400 });
  }

  if (cuenta.enviadacaja) {
    await pool.query('UPDATE cuentamesa SET enviadacaja = 0 WHERE cuentamesaid = :cuentamesaid', { cuentamesaid });
    return;
  }

  const { total } = await detalle(cuentamesaid);
  if (total <= 0) {
    throw Object.assign(new Error('No puede enviar a caja cuentas en cero'), { status: 400 });
  }
  await pool.query('UPDATE cuentamesa SET enviadacaja = 1 WHERE cuentamesaid = :cuentamesaid', { cuentamesaid });
}

module.exports = {
  contexto,
  detalle,
  crearPedido,
  enviarComandaCocina,
  generarProforma,
  toggleEnviarACaja,
  eliminarCuenta,
  trasladarProducto,
  cancelarProducto,
};
