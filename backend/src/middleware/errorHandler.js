// src/middleware/errorHandler.js
//
// WHY THIS FILE EXISTS: this is the single place in the entire application
// where an error becomes an actual HTTP response. Every asyncHandler-wrapped
// controller that throws or rejects ends up here, via next(error). Instead
// of each controller deciding its own status code, message format, and
// logging, that decision is made once, consistently, in this one file.

import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';
import config from '../config/config.js';

// Express recognizes error-handling middleware SPECIFICALLY by counting its
// parameters — exactly four: (err, req, res, next). This is not a stylistic
// choice; Express's internal routing literally checks function.length === 4
// to decide "this is an error handler, not a normal middleware." If you
// accidentally remove the unused `next` parameter, Express will treat this
// as a normal (non-error) middleware and it will never be called when an
// error occurs.
//
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // ----------------------------------------------------------------------
  // STEP 1: figure out the status code and whether this was an expected
  // ("operational") error or an unexpected one.
  //
  // We check `err instanceof AppError` rather than only `err.isOperational`
  // because instanceof is a more fundamental, harder-to-fake check — it
  // confirms this error object was genuinely constructed by our AppError
  // class. Checking isOperational alone would technically still work here
  // (since AppError always sets it), but instanceof is the more precise,
  // more "correct" check, and worth using now while it costs nothing.
  // ----------------------------------------------------------------------
  const isOperational = err instanceof AppError && err.isOperational === true;

  // If this is one of our own AppErrors, trust its statusCode. Otherwise
  // (a plain Error, a library throwing something unexpected, a database
  // driver error), we don't know what went wrong specifically, so we
  // default to 500 — "Internal Server Error" is the honest, generic
  // answer for "something broke that we didn't specifically anticipate."
  const statusCode = isOperational ? err.statusCode : 500;

  // ----------------------------------------------------------------------
  // STEP 2: log appropriately.
  //
  // Operational errors are NORMAL application behavior — a customer typing
  // the wrong password is not an incident, it happens constantly, and
  // logging every one at full severity would bury genuinely important
  // errors in noise. We still log them, just at a lower, informational
  // level, without full stack-trace detail.
  //
  // Unexpected errors ARE incidents. These get logged with everything —
  // message, stack trace, the URL and method that triggered it — because
  // someone will need this detail to actually diagnose and fix the bug.
  // ----------------------------------------------------------------------
  if (isOperational) {
    logger.warn(`Operational error: ${err.message} | ${req.method} ${req.originalUrl}`);
  } else {
    // err.stack contains BOTH the message and the full call stack, so
    // logging err.stack alone gives us everything in one line — no need
    // to also log err.message separately.
    logger.error(
      `Unexpected error: ${err.message} | ${req.method} ${req.originalUrl}\n${err.stack}`
    );
  }

  // ----------------------------------------------------------------------
  // STEP 3: build the response body sent back to the client.
  //
  // For operational errors, err.message is safe and meant to be shown —
  // that's the whole point of AppError, we wrote that message ourselves,
  // deliberately, as something a user should see (e.g. "Insufficient
  // balance").
  //
  // For unexpected errors, we NEVER show err.message or err.stack to the
  // client in production. err.message on a random thrown error could
  // easily contain something like a raw SQL error mentioning table or
  // column names — real information leakage. A generic message is the
  // safe default.
  // ----------------------------------------------------------------------
  const responseBody = {
    success: false,
    error: isOperational
      ? err.message
      : 'An unexpected error occurred. Please try again later.',
  };

  // ----------------------------------------------------------------------
  // STEP 4: in development ONLY, attach extra debugging detail. This
  // NEVER happens in production — config.server.nodeEnv comes from our
  // validated config.js, so this check is reliable rather than trusting
  // a raw, unvalidated process.env read.
  //
  // Note this applies even to operational errors in development: seeing
  // the stack trace of an AppError while developing can still be useful
  // (e.g. "which line actually threw this insufficient-balance error?"),
  // even though the message itself was already safe to show.
  // ----------------------------------------------------------------------
  if (config.server.nodeEnv !== 'production') {
    responseBody.stack = err.stack;
  }

  // STEP 5: send the response. res.status(...).json(...) sets the HTTP
  // status code AND sends the JSON body in one chained call.
  res.status(statusCode).json(responseBody);
}

export default errorHandler;