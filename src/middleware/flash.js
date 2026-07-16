function setFlash(req, tipo, mensaje) {
  req.session.flash = { tipo, mensaje };
}

function popFlash(req) {
  const flash = req.session.flash;
  if (flash) delete req.session.flash;
  return flash || null;
}

module.exports = { setFlash, popFlash };
