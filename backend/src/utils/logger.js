// src/utils/logger.js
//
// WHY THIS FILE EXISTS: every part of the app that needs to log something —
// middleware, controllers, services, app.js, server.js — imports this one
// logger instance instead of calling console.log directly. That means the
// LOGGING BEHAVIOR (format, what gets shown in dev vs prod, where logs
// eventually go) lives in exactly one place. Change it here, and every
// caller across the whole codebase benefits automatically.

import winston from 'winston';
import config from '../config/config.js';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

// ----------------------------------------------------------------------------
// DEVELOPMENT FORMAT: human-readable, colorized, one line per log.
// Example output:
//   2026-07-11 09:14:02 [info]: Server listening on port 5000
//
// This is optimized for a developer staring at a terminal — colors make
// errors jump out, and the format is easy to scan at a glance.
// ----------------------------------------------------------------------------
const devFormat = combine(
  colorize(), // adds ANSI color codes based on level (red for error, yellow for warn, etc.)
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }), // if a log call includes an Error object, print its stack trace
  printf(({ timestamp: ts, level, message, stack }) => {
    // If an error was logged, show its stack trace instead of just the message —
    // far more useful when debugging.
    return stack
      ? `${ts} [${level}]: ${message}\n${stack}`
      : `${ts} [${level}]: ${message}`;
  })
);

// ----------------------------------------------------------------------------
// PRODUCTION FORMAT: structured JSON, one object per line, no color codes.
//
// WHY DIFFERENT FROM DEV: in production, logs aren't read by a human
// watching a terminal — they're collected by a log aggregation system
// (e.g. CloudWatch, ELK, Datadog) that expects structured, machine-parseable
// data. JSON lets that system filter/search by field ("show me every ERROR
// from the last hour") instead of needing to parse free-form text with
// regular expressions. Color codes (ANSI escape characters) would actively
// corrupt JSON output, so colorize() is deliberately NOT used here.
// ----------------------------------------------------------------------------
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

// ----------------------------------------------------------------------------
// TRANSPORTS: WHERE logs are sent. Right now, just the console. This array
// is exactly what requirement 7 is about — adding a database transport or
// a file transport later means adding an entry to THIS array. Nothing in
// app.js, middleware, controllers, or services would need to change, because
// they only ever call logger.info(...) / logger.error(...) etc. — they never
// know or care where the log actually ends up.
//
// Example of what a later milestone might add here, without touching any
// other file in the project:
//   new winston.transports.File({ filename: 'logs/error.log', level: 'error' })
//   new CustomDatabaseTransport({ ... })  // writes to the security_logs table
// ----------------------------------------------------------------------------
const transports = [
  new winston.transports.Console(),
];

// ----------------------------------------------------------------------------
// LOG LEVEL: how much detail gets shown.
//
// Winston's built-in npm levels, most to least severe: error, warn, info,
// http, verbose, debug, silly. Setting level: 'debug' means "show debug
// and everything more severe than debug" (error, warn, info, debug) —
// it does NOT mean "show only debug". In production we set level: 'info',
// which hides debug-level noise that's only useful while developing.
// ----------------------------------------------------------------------------
const level = config.server.nodeEnv === 'production' ? 'info' : 'debug';
const format = config.server.nodeEnv === 'production' ? prodFormat : devFormat;

// ----------------------------------------------------------------------------
// THE LOGGER INSTANCE: created once, exported once, imported everywhere.
// This is a singleton — every file that does `import logger from
// '../utils/logger.js'` gets the exact same instance, not a new one each
// time. That matters because it means logging configuration is consistent
// everywhere, with no risk of one file accidentally logging in a different
// format than another.
// ----------------------------------------------------------------------------
const logger = winston.createLogger({
  level,
  format,
  transports,
  // exitOnError: false means a logging error itself will never crash the
  // whole application — logging should never be the reason a banking
  // system goes down.
  exitOnError: false,
});

export default logger;