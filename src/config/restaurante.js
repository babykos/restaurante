const RESTAURANTEID = Number(process.env.RESTAURANTEID);

if (!RESTAURANTEID) {
  throw new Error('Falta configurar RESTAURANTEID en el archivo .env');
}

module.exports = { RESTAURANTEID };
