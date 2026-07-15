const express = require('express');
const { autenticar } = require('../services/auth');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', async (req, res, next) => {
  try {
    const { usuario, clave } = req.body;
    const user = await autenticar(usuario, clave);

    if (!user) {
      return res.status(401).render('login', { error: 'Usuario o clave incorrectos' });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = user;
      res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

module.exports = router;
