const express = require('express');
const { requireEncargado } = require('../middleware/auth');
const estadisticasService = require('../services/estadisticas');

const router = express.Router();

function formatoFecha(d) {
  return d.toISOString().slice(0, 10);
}

router.get('/', requireEncargado, async (req, res, next) => {
  try {
    const hoyStr = formatoFecha(new Date());

    const desde = req.query.desde || hoyStr;
    const hasta = req.query.hasta || hoyStr;
    const restauranteid = req.query.restauranteid ? Number(req.query.restauranteid) : null;
    const usuarioid = req.query.usuarioid ? Number(req.query.usuarioid) : null;

    const filtros = { desde, hasta, restauranteid, usuarioid };

    const [
      restaurantesLista,
      meserosLista,
      ventasPorMesero,
      ventasPorCategoria,
      productosFacturados,
      productosNoFacturados,
      cancelaciones,
      mesasEliminadas,
    ] = await Promise.all([
      estadisticasService.restaurantes(),
      estadisticasService.meseros(),
      estadisticasService.ventasPorMesero(filtros),
      estadisticasService.ventasPorCategoria(filtros),
      estadisticasService.productosVendidos(filtros),
      estadisticasService.productosSinVentas(filtros),
      estadisticasService.cancelaciones(filtros),
      estadisticasService.mesasEliminadas(filtros),
    ]);

    const totales = {
      vendido: ventasPorMesero.reduce((n, m) => n + Number(m.total_vendido), 0),
      propinas: ventasPorMesero.reduce((n, m) => n + Number(m.total_propinas), 0),
      cancelaciones: cancelaciones.length,
      mesasEliminadas: mesasEliminadas.length,
    };

    res.render('estadisticas/index', {
      desde,
      hasta,
      restauranteid,
      usuarioid,
      restaurantesLista,
      meserosLista,
      totales,
      ventasPorMesero,
      ventasPorCategoria,
      productosFacturados,
      productosNoFacturados,
      cancelaciones,
      mesasEliminadas,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/mesa-eliminada/:reservaid/preview', requireEncargado, async (req, res, next) => {
  try {
    const reservaid = Number(req.params.reservaid);
    const datos = await estadisticasService.previewReserva(reservaid);
    if (!datos) {
      return res.status(404).send('Reserva no encontrada');
    }
    res.render('estadisticas/preview-mesa', {
      reserva: datos.reserva,
      cuentas: datos.cuentas,
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
