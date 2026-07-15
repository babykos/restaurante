const { contexto } = require('../services/cuentas');

async function cargarCuentaYValidarDueno(req, res, next) {
  try {
    const cuentamesaid = Number(req.params.cuentamesaid);
    const cuenta = await contexto(cuentamesaid);

    if (!cuenta) {
      return res.status(404).send('Cuenta no encontrada');
    }

    const esDueno = cuenta.duenoid === req.session.user.usuarioid;
    const esEncargado = req.session.user.rol === 'encargado';

    if (!esDueno && !esEncargado) {
      return res.status(403).send('No autorizado');
    }

    req.cuenta = cuenta;
    next();
  } catch (err) {
    next(err);
  }
}

function bloqueadaParaPedidos(cuenta) {
  return Boolean(cuenta.nodocumento) || cuenta.inactiva === 1 || cuenta.enviadacaja === 1;
}

module.exports = { cargarCuentaYValidarDueno, bloqueadaParaPedidos };
