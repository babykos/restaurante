const express = require('express');
const { requireAuth, requireEncargado } = require('../middleware/auth');
const { cargarCuentaYValidarDueno, bloqueadaParaPedidos } = require('../middleware/cuentas');
const { setFlash, popFlash } = require('../middleware/flash');
const { catalogo, variantes, asistentes } = require('../services/productos');
const cuentasService = require('../services/cuentas');

const router = express.Router();

router.get('/:cuentamesaid', requireAuth, cargarCuentaYValidarDueno, async (req, res, next) => {
  try {
    const [productos, variantesProductos, asistentesProductos, pedido] = await Promise.all([
      catalogo(),
      variantes(),
      asistentes(),
      cuentasService.detalle(req.cuenta.cuentamesaid),
    ]);
    res.render('cuentas/show', {
      cuenta: req.cuenta,
      productos,
      variantesProductos,
      asistentesProductos,
      pedido,
      bloqueada: bloqueadaParaPedidos(req.cuenta),
      flash: popFlash(req),
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:cuentamesaid/pedido', requireAuth, cargarCuentaYValidarDueno, async (req, res, next) => {
  try {
    if (bloqueadaParaPedidos(req.cuenta)) {
      return res.status(400).send('Esta cuenta ya no admite nuevos pedidos');
    }

    let items;
    try {
      items = JSON.parse(req.body.items || '[]');
    } catch {
      return res.status(400).send('Items inválidos');
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).send('Debe agregar al menos un producto');
    }
    for (const item of items) {
      item.productoid = Number(item.productoid);
      item.cantidad = Number(item.cantidad);
      if (!item.productoid || !(item.cantidad > 0)) {
        return res.status(400).send('Producto o cantidad inválida');
      }
      if (item.opcionids !== undefined) {
        if (!Array.isArray(item.opcionids)) {
          return res.status(400).send('Opciones de asistente inválidas');
        }
        item.opcionids = item.opcionids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
      }
    }

    const pedidomesaid = await cuentasService.crearPedido(req.cuenta.cuentamesaid, req.cuenta.reservaid, {
      items,
      comentarios: req.body.comentarios || '',
      llevar: req.body.llevar === '1',
    });

    await cuentasService.enviarComandaCocina(pedidomesaid, req.cuenta.restauranteid);

    res.redirect(`/cuentas/${req.cuenta.cuentamesaid}`);
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
    next(err);
  }
});

router.post('/:cuentamesaid/proforma', requireAuth, cargarCuentaYValidarDueno, async (req, res, next) => {
  try {
    await cuentasService.generarProforma(req.cuenta.cuentamesaid, req.cuenta.restauranteid);
    setFlash(req, 'success', 'Proforma generada');
    res.redirect(`/mesas/${req.cuenta.mesaid}/cuentas`);
  } catch (err) {
    next(err);
  }
});

router.post('/:cuentamesaid/enviar-caja', requireAuth, cargarCuentaYValidarDueno, async (req, res, next) => {
  try {
    const estabaEnviada = req.cuenta.enviadacaja === 1;
    await cuentasService.toggleEnviarACaja(req.cuenta.cuentamesaid);
    setFlash(req, 'success', estabaEnviada ? 'Cuenta recuperada de caja' : 'Cuenta enviada a caja');
    res.redirect(`/mesas/${req.cuenta.mesaid}/cuentas`);
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
    next(err);
  }
});

router.post('/:cuentamesaid/trasladar-producto', requireAuth, cargarCuentaYValidarDueno, async (req, res, next) => {
  try {
    const productoid = Number(req.body.productoid);
    const cantidad = Number(req.body.cantidad);
    const destino = Number(req.body.destino);
    const descripcion = req.body.descripcion || '';

    if (!productoid || !(cantidad > 0) || !destino) {
      return res.status(400).send('Datos de traslado inválidos');
    }

    await cuentasService.trasladarProducto(req.cuenta.cuentamesaid, { productoid, descripcion, cantidad, destino });
    setFlash(req, 'success', 'Producto trasladado');
    res.redirect(`/mesas/${req.cuenta.mesaid}/cuentas`);
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
    next(err);
  }
});

router.post('/:cuentamesaid/cancelar-producto', requireEncargado, cargarCuentaYValidarDueno, async (req, res, next) => {
  try {
    const productoid = Number(req.body.productoid);
    const cantidad = Number(req.body.cantidad);
    const descripcion = req.body.descripcion || '';

    if (!productoid || !(cantidad > 0)) {
      return res.status(400).send('Datos de cancelación inválidos');
    }

    await cuentasService.cancelarProducto(req.cuenta.cuentamesaid, { productoid, descripcion, cantidad });
    setFlash(req, 'success', 'Producto cancelado');
    res.redirect(`/mesas/${req.cuenta.mesaid}/cuentas`);
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
    next(err);
  }
});

router.post('/:cuentamesaid/eliminar', requireAuth, cargarCuentaYValidarDueno, async (req, res, next) => {
  try {
    await cuentasService.eliminarCuenta(req.cuenta.cuentamesaid);
    res.redirect(`/mesas/${req.cuenta.mesaid}/cuentas`);
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
    next(err);
  }
});

module.exports = router;
