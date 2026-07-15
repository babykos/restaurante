const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { mapaDeMesas, cuentasDeMesa, duenoDeMesa, abrirMesa } = require('../services/mesas');

const router = express.Router();

function agruparPorZona(mesas, usuarioid) {
  const zonas = new Map();
  for (const m of mesas) {
    if (!zonas.has(m.zonaid)) {
      zonas.set(m.zonaid, { zonaid: m.zonaid, zona: m.zona, hex: m.hex, mesas: [] });
    }
    let estado = 'libre';
    if (m.reservaidasignada) {
      estado = m.duenoid === usuarioid ? 'mia' : 'ocupada';
    }
    zonas.get(m.zonaid).mesas.push({ ...m, estado });
  }
  return [...zonas.values()];
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const mesas = await mapaDeMesas();
    const zonas = agruparPorZona(mesas, req.session.user.usuarioid);
    res.render('mesas/index', { zonas, user: req.session.user });
  } catch (err) {
    next(err);
  }
});

router.get('/:mesaid/cuentas', requireAuth, async (req, res, next) => {
  try {
    const mesaid = Number(req.params.mesaid);
    const duenoid = await duenoDeMesa(mesaid);

    if (duenoid === null) {
      return res.redirect('/mesas');
    }
    if (duenoid !== req.session.user.usuarioid && req.session.user.rol !== 'encargado') {
      return res.status(403).send('No autorizado');
    }

    const cuentas = await cuentasDeMesa(mesaid);
    res.render('mesas/cuentas', { mesaid, cuentas, user: req.session.user });
  } catch (err) {
    next(err);
  }
});

router.post('/:mesaid/abrir', requireAuth, async (req, res, next) => {
  try {
    const mesaid = Number(req.params.mesaid);
    const nombrecuenta = (req.body.nombrecuenta || '').trim() || `MESA ${mesaid}`;

    const cuentamesaid = await abrirMesa(mesaid, req.session.user.usuarioid, nombrecuenta);
    res.redirect(`/cuentas/${cuentamesaid}`);
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
    next(err);
  }
});

module.exports = router;
