const express = require('express');
const { requireAuth } = require('../middleware/auth');
const trasladosService = require('../services/traslados');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const usuarioid = req.session.user.usuarioid;
    const [recibidos, enviados] = await Promise.all([
      trasladosService.pendientesRecibidos(usuarioid),
      trasladosService.pendientesEnviados(usuarioid),
    ]);
    res.render('traslados/index', { recibidos, enviados, user: req.session.user });
  } catch (err) {
    next(err);
  }
});

router.post('/:trasladoid/aceptar', requireAuth, async (req, res, next) => {
  try {
    const trasladoid = Number(req.params.trasladoid);
    await trasladosService.aceptarTraslado(trasladoid, req.session.user.usuarioid);
    res.redirect('/traslados');
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
    next(err);
  }
});

module.exports = router;
