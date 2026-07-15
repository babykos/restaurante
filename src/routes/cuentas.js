const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { cargarCuentaYValidarDueno, bloqueadaParaPedidos } = require('../middleware/cuentas');
const { catalogo } = require('../services/productos');
const cuentasService = require('../services/cuentas');

const router = express.Router();

router.get('/:cuentamesaid', requireAuth, cargarCuentaYValidarDueno, async (req, res, next) => {
  try {
    const [productos, pedido] = await Promise.all([catalogo(), cuentasService.detalle(req.cuenta.cuentamesaid)]);
    res.render('cuentas/show', {
      cuenta: req.cuenta,
      productos,
      pedido,
      bloqueada: bloqueadaParaPedidos(req.cuenta),
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
    res.redirect(`/cuentas/${req.cuenta.cuentamesaid}`);
  } catch (err) {
    next(err);
  }
});

router.post('/:cuentamesaid/enviar-caja', requireAuth, cargarCuentaYValidarDueno, async (req, res, next) => {
  try {
    await cuentasService.enviarACaja(req.cuenta.cuentamesaid);
    res.redirect(`/cuentas/${req.cuenta.cuentamesaid}`);
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
    next(err);
  }
});

module.exports = router;
