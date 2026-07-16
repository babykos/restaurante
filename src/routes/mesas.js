const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  mapaDeMesas,
  cuentasDeMesa,
  contextoMesa,
  duenoDeMesa,
  abrirMesa,
  abrirSubcuenta,
} = require('../services/mesas');
const cuentasService = require('../services/cuentas');
const trasladosService = require('../services/traslados');

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
    const mesa = await contextoMesa(mesaid);

    if (!mesa || !mesa.duenoid) {
      return res.redirect('/mesas');
    }
    if (mesa.duenoid !== req.session.user.usuarioid && req.session.user.rol !== 'encargado') {
      return res.status(403).send('No autorizado');
    }

    const cuentasBase = await cuentasDeMesa(mesaid);
    const [cuentas, usuariosParaTraslado] = await Promise.all([
      Promise.all(cuentasBase.map(async (c) => ({ ...c, pedido: await cuentasService.detalle(c.cuentamesaid) }))),
      trasladosService.usuariosActivos(req.session.user.usuarioid),
    ]);

    res.render('mesas/cuentas', { mesa, cuentas, usuariosParaTraslado, user: req.session.user });
  } catch (err) {
    next(err);
  }
});

router.post('/:mesaid/trasladar', requireAuth, async (req, res, next) => {
  try {
    const mesaid = Number(req.params.mesaid);
    const mesa = await contextoMesa(mesaid);

    if (!mesa || !mesa.duenoid) {
      return res.redirect('/mesas');
    }
    if (mesa.duenoid !== req.session.user.usuarioid && req.session.user.rol !== 'encargado') {
      return res.status(403).send('No autorizado');
    }

    const recibeId = Number(req.body.recibeId);
    if (!recibeId) {
      return res.status(400).send('Debe elegir un mesero destino');
    }

    await trasladosService.solicitarTraslado(mesa.reservaid, req.session.user.usuarioid, recibeId);
    res.redirect(`/mesas/${mesaid}/cuentas`);
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
    next(err);
  }
});

router.post('/:mesaid/cuentas', requireAuth, async (req, res, next) => {
  try {
    const mesaid = Number(req.params.mesaid);
    const duenoid = await duenoDeMesa(mesaid);

    if (duenoid === null) {
      return res.redirect('/mesas');
    }
    if (duenoid !== req.session.user.usuarioid && req.session.user.rol !== 'encargado') {
      return res.status(403).send('No autorizado');
    }

    const nombrecuenta = (req.body.nombrecuenta || '').trim();
    if (!nombrecuenta) {
      return res.status(400).send('El nombre de la cuenta es obligatorio');
    }

    await abrirSubcuenta(mesaid, nombrecuenta);
    res.redirect(`/mesas/${mesaid}/cuentas`);
  } catch (err) {
    if (err.status) return res.status(err.status).send(err.message);
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
