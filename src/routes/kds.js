const express = require('express');
const kdsService = require('../services/kds');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const estaciones = await kdsService.estaciones();
    res.render('kds/seleccion', { estaciones });
  } catch (err) {
    next(err);
  }
});

router.get('/:zonaid', async (req, res, next) => {
  try {
    const zonaid = Number(req.params.zonaid);
    const estacion = await kdsService.estacion(zonaid);
    if (!estacion) {
      return res.redirect('/kds');
    }
    res.render('kds/pantalla', { estacion });
  } catch (err) {
    next(err);
  }
});

router.get('/:zonaid/historico', async (req, res, next) => {
  try {
    const zonaid = Number(req.params.zonaid);
    const estacion = await kdsService.estacion(zonaid);
    if (!estacion) {
      return res.redirect('/kds');
    }
    const historico = await kdsService.historico(zonaid, 50);
    res.render('kds/historico', { estacion, historico });
  } catch (err) {
    next(err);
  }
});

router.get('/:zonaid/pedidos', async (req, res, next) => {
  try {
    const zonaid = Number(req.params.zonaid);
    const pedidos = await kdsService.pedidosPendientes(zonaid);
    res.json(pedidos);
  } catch (err) {
    next(err);
  }
});

router.post('/:zonaid/pedidos/:pedidomesaid/listo', async (req, res, next) => {
  try {
    const zonaid = Number(req.params.zonaid);
    const pedidomesaid = Number(req.params.pedidomesaid);
    await kdsService.marcarListo(pedidomesaid, zonaid);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
