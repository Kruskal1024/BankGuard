// src/middleware/notFound.js
//
// WHY THIS FILE EXISTS: Express runs middleware and routes in the exact
// order they're registered in app.js. If a request comes in for a path
// that matches none of our defined routes, Express just keeps falling
// through the middleware chain with nothing handling it — UNLESS we
// register something at the very end (after all real routes, before the
// error handler) that catches whatever's left over. That's this file's
// entire job.

import AppError from '../utils/AppError.js';

// Unlike errorHandler.js, this is a NORMAL (three-parameter) middleware,
// not an error handler — it runs as part of the regular middleware chain,
// specifically because it's registered after every real route but before
// errorHandler.js in app.js. If a request reaches this function at all,
// that already tells us something: no earlier route matched it.
function notFound(req, res, next) {
  // We don't send a response here ourselves — instead, we create an
  // AppError describing exactly what wasn't found, and pass it to next().
  // That routes it straight into errorHandler.js, so a 404 gets logged
  // and formatted through the exact same pipeline as every other error
  // in the app, instead of needing its own separate response logic here.
  const message = `Route not found: ${req.method} ${req.originalUrl}`;
  next(new AppError(message, 404));
}

export default notFound;