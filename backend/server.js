// server.js — the only file that starts the HTTP listener.
// Everything else (routes, middleware, business logic) lives behind app.js.

const app = require('./app');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`BankGuard backend listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});
