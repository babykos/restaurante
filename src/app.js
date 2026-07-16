require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./routes/auth');
const mesasRoutes = require('./routes/mesas');
const cuentasRoutes = require('./routes/cuentas');
const trasladosRoutes = require('./routes/traslados');
const estadisticasRoutes = require('./routes/estadisticas');
const { requireAuth } = require('./middleware/auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 },
  })
);

app.use('/', authRoutes);
app.use('/mesas', mesasRoutes);
app.use('/cuentas', cuentasRoutes);
app.use('/traslados', trasladosRoutes);
app.use('/estadisticas', estadisticasRoutes);

app.get('/', requireAuth, (req, res) => {
  res.redirect('/mesas');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
