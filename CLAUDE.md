
# RESTAURANTE — App web de meseros (Node.js)

## Contexto del proyecto

Reemplazo de la app actual de meseros (PHP, en `C:\Users\Pedruca\Documents\NetBeansProjects\meseros`)
por una app Node.js que consume **la misma base de datos MySQL** que usa el ERP/POS de escritorio
**Maverick** (Java Swing, `C:\Users\Pedruca\Documents\NetBeansProjects\maverick`).

Reglas de oro:
- **No se modifica el esquema de la base de datos** a menos que sea estrictamente necesario.
  Está permitido *insertar filas de datos* (p. ej. en `CONFIGURACION`), pero no alterar tablas/columnas.
- La creación de zonas, mesas y restaurantes se sigue gestionando desde Maverick (escritorio). Esta app
  web NO administra ese catálogo, solo lo consume.
- Acceso solo por intranet (no expuesto a internet público) — no es requisito por ahora TLS público/WAF,
  pero sí buenas prácticas de auth internas.
- Las impresiones de comandas/proformas se siguen manejando 100% vía la tabla `COMANDOS`
  (mecanismo de cola que ya usa el escritorio Maverick, `ListadoComandos.java`). Esta app web NO imprime
  directo, solo inserta filas en `COMANDOS` para que el escritorio las procese.

## Modelo de datos reutilizado (MySQL, ya existente — ver detalle de columnas en el análisis previo)

- `MESAS` (mesaid PK, zonaid FK, nomesa, activa, reservaidasignada FK nullable → mesa ocupada)
- `ZONAS` (zonaid PK, empresaid, restauranteid FK, zona, activa, hex)
- `RESTAURANTES` (restauranteid PK, restaurante, estado)
- `RESERVAMESA` (reservaid PK, usuarioid FK = mesero dueño, mesaid FK, fecha, eliminada, razon)
- `CUENTAMESA` (cuentamesaid PK, reservaid FK, nombrecuenta, inactiva, propina, ppropina, enviadacaja,
  nodocumento FK nullable → facturaenc)
- `PEDIDOSMESA` (pedidomesaid PK, fecha, reservaid FK, llevar, nopedido, comentarios)
- `DETALLEPEDIDO` (detallepedidoid PK, pedidomesaid FK, productoid FK, cuentamesaid FK, cantidad,
  descripcion, cancelado, cortesia, precio, porcentajeisv, padre_detallepedidoid → jerarquía combos)
- `USUARIOS` (usuarioid PK, perfilid FK, usuario, clave [MD5 sin salt], estado)
- `CONFIGURACION` (configuracionid PK, estacionid FK nullable, llave, valor, ids [CSV], descripcion,
  categoria) — tabla de parámetros de Maverick, se reutiliza para roles (ver abajo).
- `COMANDOS` (comandoid PK, comando, parametro, parametro2, ejecutado, fecha) — cola de trabajos de
/paneldecontrol/confRestaurante.java`):

```sql
SELECT ids FROM configuracion
WHERE categoria = 'confRestaurante' AND llave = 'PERFIL_ADMINISTRADOR' AND estacionid IS NULL

- Encargado (admin de esta app web) = mismo parámetro PERFIL_ADMINISTRADOR que ya usa el
escritorio (decisión confirmada con el usuario: "encargado sería igual a perfil administrador").
- ids es un CSV de perfilid. En el login, tras validar credenciales, se debe:
  a. Leer usuarios.perfilid del usuario autenticado.
  b. Consultar CONFIGURACION con categoria='confRestaurante', llave='PERFIL_ADMINISTRADOR',
estacionid IS NULL.
  c. Si perfilid está en la lista ids → rol encargado. Si no → rol mesero (default, igual que
hoy en PHP, pero ahora sí diferenciado).
- Cachear esta lista en memoria del proceso Node con TTL corto (p. ej. 60s) para no golpear la BD en
de negocio a portar

Mesero

- Mis mesas: filtrar por reservamesa.usuarioid = :usuarioid (igual que
models/mesas.php::MesasdeUsuario del PHP actual).
- Abrir mesa/cuenta: crear RESERVAMESA si no existe + CUENTAMESA (recordar llenar ppropina,
el PHP actual lo omite — bug a corregir).
mesas/acc/mover.php (PHP).
- Enviar a caja: UPDATE cuentamesa SET enviadacaja=1.
- Validación server-side obligatoria (el PHP actual NO la tiene y es un hueco de seguridad): en toda
acción mutadora, verificar que reservamesa.usuarioid del recurso == usuario de la sesión, o que el
usuario tenga rol encargado.

Encargado (Administrador)

- Dashboard completo (todas las zonas/mesas del restaurante, no solo las propias).
- Histórico de cuentas/pedidos: portar la lógica SQL de dbCuentaMesa.Historico()
(maverick/src/tablas/dbCuentaMesa.java), que ya distingue estado FACTURADA / INACTIVA / ELIMINADA / NO FACTURADA.
- Resumen de ventas por producto y por día: query nueva (no existe hoy en ningún lado), agregando
DETALLEPEDIDO (con cancelado=0) por productoid y por fecha (pedidosmesa.fecha o
cuentamesa.creacion). Debe incluir tanto lo facturado (cruzando cuentamesa.nodocumento →
facturaenc/facturadet) como lo no facturado/pendiente (decisión confirmada con el usuario),
distinguiendo el estado por fila igual que hace Historico().

Impresión de comandas — regla no negociable

Se mantiene la tabla COMANDOS como único canal de impresión (consumida por
ListadoComandos.java del escritorio Maverick). Comandos válidos usados hoy:
IMPRESION_COMANDA (parametro=pedidomesaid), GENERAR_PROFORMA (parametro=cuentamesaid).
TODAS las comandas pendientes (no solo la fila afectada) hasta que se
limpie manualmente. Toda inserción en COMANDOS desde Node debe llenar parametro2 con el
restauranteid correcto (resuelto vía cuentamesa → reservamesa → mesas → zonas.restauranteid).

Otros hallazgos a tener en cuenta (no bloquean el diseño, pero conviene no repetirlos)

- El PHP actual arma SQL con concatenación directa de strings en la mayoría de métodos custom (fuera de
ins/upd/find que sí usan PDO preparado) → riesgo de inyección SQL. En Node, usar siempre queries
parametrizadas (placeholders ?/:nombre) con mysql2/Knex/Prisma, sin excepción.
exactas: maverick/src/tablas/dbMesas.java, dbZonas.java,
dbRestaurantes.java, dbReservaMesa.java, dbCuentaMesa.java, dbPedidosMesa.java,
dbDetallePedido.java, dbComandos.java, dbConfiguracion.java, dbUsuarios.java.
- Reglas de negocio de escritorio a portar: maverick/src/vistas/restaurante/PicinaReservas.java,
PanelCuenta.java, PanelMesa.java, frmControldeMesa.java.
- Permisos ya configurados en Maverick: maverick/src/vistas/paneldecontrol/confRestaurante.java.
- Referencia de flujo actual (PHP a reemplazar): meseros/apps/pedidos/acc/realizarpedido.php,
ón a NO replicar).

Estado del análisis

Fase actual: solo análisis/planeación, aún no se ha iniciado código del proyecto Node.
Pendiente de definir: stack exacto de Node (Express/Fastify, ORM/query builder, motor de plantillas o
SPA/API separada para el frontend), estructura de carpetas, y arranque del proyecto.

Con esto, la próxima vez que abras `claude` dentro de `C:\Users\Pedruca\Desktop\RESTAURANTE`, va a cargar automáticamente todo este contexto sin que tengas que repetírmelo. Cuando quieras, dime y seguimos definiendo el stack técnico y la estructura del proyecto Node ya en esa carpeta.