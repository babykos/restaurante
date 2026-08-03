const pool = require('../config/db');

async function catalogo() {
  const [rows] = await pool.query(
    `SELECT p.productoid, p.producto, p.precioventa, p.categoriaid, c.categoria,
            COALESCE(i.porcentaje, 0) AS porcentajeisv, IFNULL(p.grupoid, 0) AS grupoid,
            (p.tipo = 'Asistente') AS esAsistente
     FROM productos p
     JOIN categoriasproductos c ON c.categoriaid = p.categoriaid
     LEFT JOIN impuestos i ON i.impuestoid = p.impuestoid
     WHERE p.activo = 1 AND c.publicado = 1
     ORDER BY c.orden, c.categoria, p.producto`
  );
  return rows;
}

async function categorias() {
  const [rows] = await pool.query(
    `SELECT categoriaid, categoria, padre
     FROM categoriasproductos
     WHERE publicado = 1
     ORDER BY orden, categoria`
  );
  return rows;
}

async function variantes() {
  const [rows] = await pool.query('SELECT varianteid, grupoid, variante FROM variantesproductos ORDER BY grupoid, variante');
  return rows;
}

async function asistentes() {
  const [grupos] = await pool.query(
    `SELECT grupoid, productoid, grupo, seleccion_maxima, obligatorio, orden
     FROM asistente_grupos
     ORDER BY productoid, orden`
  );
  const [opciones] = await pool.query(
    `SELECT ao.opcionid, ao.grupoid, ao.productoid, p.producto, ao.precioadicional, ao.orden
     FROM asistente_opciones ao
     JOIN productos p ON p.productoid = ao.productoid
     WHERE ao.activo = 1
     ORDER BY ao.grupoid, ao.orden`
  );

  const opcionesPorGrupo = {};
  for (const o of opciones) {
    if (!opcionesPorGrupo[o.grupoid]) opcionesPorGrupo[o.grupoid] = [];
    opcionesPorGrupo[o.grupoid].push({
      productoid: o.productoid,
      producto: o.producto,
      precioadicional: Number(o.precioadicional),
    });
  }

  const gruposPorProducto = {};
  for (const g of grupos) {
    if (!gruposPorProducto[g.productoid]) gruposPorProducto[g.productoid] = [];
    gruposPorProducto[g.productoid].push({
      grupoid: g.grupoid,
      grupo: g.grupo,
      seleccionMaxima: g.seleccion_maxima,
      obligatorio: Boolean(g.obligatorio),
      opciones: opcionesPorGrupo[g.grupoid] || [],
    });
  }

  return gruposPorProducto;
}

async function obtenerPrecioImpuesto(productoid) {
  const [rows] = await pool.query(
    `SELECT p.producto, p.precioventa, COALESCE(i.porcentaje, 0) AS porcentajeisv
     FROM productos p
     LEFT JOIN impuestos i ON i.impuestoid = p.impuestoid
     WHERE p.productoid = :productoid AND p.activo = 1`,
    { productoid }
  );
  return rows.length ? rows[0] : null;
}

async function resolverAsistente(productoidPadre, opcionidsSeleccionados) {
  const [grupos] = await pool.query(
    `SELECT grupoid, grupo, seleccion_maxima, obligatorio, orden
     FROM asistente_grupos WHERE productoid = :productoidPadre ORDER BY orden`,
    { productoidPadre }
  );
  if (grupos.length === 0) {
    throw Object.assign(new Error('Este producto no tiene un asistente configurado'), { status: 400 });
  }

  const grupoIds = grupos.map((g) => g.grupoid);
  const seleccionSet = new Set((opcionidsSeleccionados || []).map(Number));

  const [opciones] = await pool.query(
    `SELECT ao.opcionid, ao.grupoid, ao.productoid, p.producto, ao.precioadicional
     FROM asistente_opciones ao
     JOIN productos p ON p.productoid = ao.productoid
     WHERE ao.grupoid IN (:grupoIds) AND ao.activo = 1`,
    { grupoIds }
  );

  let totalExtras = 0;
  const seleccionadas = [];

  for (const grupo of grupos) {
    const opcionesDelGrupo = opciones.filter((o) => o.grupoid === grupo.grupoid);
    const elegidas = opcionesDelGrupo.filter((o) => seleccionSet.has(o.productoid));

    if (grupo.obligatorio && elegidas.length === 0) {
      throw Object.assign(new Error(`Debes seleccionar al menos una opción en "${grupo.grupo}"`), { status: 400 });
    }
    if (elegidas.length > grupo.seleccion_maxima) {
      throw Object.assign(
        new Error(`Solo puedes elegir hasta ${grupo.seleccion_maxima} opciones en "${grupo.grupo}"`),
        { status: 400 }
      );
    }

    for (const o of elegidas) {
      seleccionadas.push(o);
      totalExtras += Number(o.precioadicional);
    }
  }

  const datosPadre = await obtenerPrecioImpuesto(productoidPadre);
  if (!datosPadre) {
    throw Object.assign(new Error('El producto principal no existe o está inactivo'), { status: 400 });
  }

  const descripcion = `${datosPadre.producto} (${seleccionadas.map((o) => o.producto).join(', ')})`;
  const precioTotal = Number(datosPadre.precioventa) + totalExtras;

  return {
    descripcion,
    precioTotal,
    porcentajeisv: datosPadre.porcentajeisv,
    seleccionadas,
  };
}

module.exports = { catalogo, categorias, obtenerPrecioImpuesto, variantes, asistentes, resolverAsistente };
