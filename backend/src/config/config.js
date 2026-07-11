// src/config/config.js
//
// WHY THIS FILE EXISTS: this is the ONLY place in the entire codebase that
// reads `process.env` directly. Every other file that needs a port number,
// a database password, or a JWT secret imports the `config` object from
// here instead of touching `process.env` itself. That gives us exactly one
// place to see the full list of things the app depends on, one place to
// validate them, and one place to change if a variable is ever renamed.
//
// WHY WE VALIDATE AT STARTUP, NOT WHEN A VARIABLE IS FIRST USED: if we
// didn't check, a missing DATABASE_PASSWORD wouldn't fail until the first
// time someone tries to log in, and the error at that point ("Access
// denied for user") wouldn't obviously point back to a missing .env
// variable. Failing immediately, at boot, with a message naming exactly
// which variables are missing, turns a confusing runtime bug into an
// obvious, easy-to-fix startup message.

import dotenv from 'dotenv';

// Reads the .env file in the project root and loads its key=value pairs
// into process.env. This MUST run before we read any process.env value
// below — dotenv doesn't do anything automatically just by being
// installed, it only acts when .config() is called.
dotenv.config();

// ----------------------------------------------------------------------------
// STEP 1: List every environment variable this application cannot safely
// run without. If any of these are missing, we stop the app rather than
// let it start in a half-configured, unpredictable state.
// ----------------------------------------------------------------------------
const REQUIRED_VARS = [
  'PORT',
  'NODE_ENV',
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ACCESS_EXPIRY',
  'JWT_REFRESH_EXPIRY',
  'EMAIL_HOST',
  'EMAIL_PORT',
  'EMAIL_USER',
  'EMAIL_PASSWORD',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_ATTEMPTS',
  'FRAUD_LARGE_TXN_THRESHOLD',
];

// ----------------------------------------------------------------------------
// STEP 2: Check each required variable actually has a value.
//
// We check `=== undefined` AND an empty string, because a line like
// `DATABASE_PASSWORD=` in a .env file (key present, but no value typed
// after the equals sign) would otherwise pass a simple "does the key
// exist" check while still being useless to the application.
// ----------------------------------------------------------------------------
const missingVars = REQUIRED_VARS.filter((key) => {
  const value = process.env[key];
  return value === undefined || value.trim() === '';
});

if (missingVars.length > 0) {
  // console.error, not console.log — this is an error condition and
  // should be visible even if normal logs are being filtered somewhere.
  console.error('❌ Missing required environment variables:');
  missingVars.forEach((key) => console.error(`   - ${key}`));
  console.error('\nCopy .env.example to .env and fill in real values before starting the server.');

  // process.exit(1): stops the Node process immediately. The argument 1
  // (as opposed to 0) tells the operating system / whatever started this
  // process "this ended because of an error", which matters if this app
  // is ever run inside a script, CI pipeline, or container orchestrator
  // that checks exit codes to decide what to do next.
  process.exit(1);
}

// ----------------------------------------------------------------------------
// STEP 3: Build one clean, grouped configuration object.
//
// Grouping by concern (server / database / jwt / email / rateLimit /
// fraud) rather than exporting 18 flat variables means calling code reads
// naturally: `config.database.host` instead of `config.DATABASE_HOST` —
// and it mirrors how these values are actually used together elsewhere
// in the app (e.g. the entire `database` group gets passed as one object
// to mysql2's createPool() in the next file we build).
//
// Every process.env value is a STRING, even ones that are conceptually
// numbers (e.g. process.env.PORT is the string "5000", not the number
// 5000). Number(...) converts those explicitly where the value is
// actually used as a number later (e.g. in comparisons, timers, or
// mysql2's connection config, which expects a numeric port).
// ----------------------------------------------------------------------------
const config = {
  server: {
    port: Number(process.env.PORT),
    nodeEnv: process.env.NODE_ENV,
  },

  database: {
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    name: process.env.DATABASE_NAME,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    // Expiry values (e.g. "15m", "7d") are duration STRINGS understood by
    // the jsonwebtoken library's `expiresIn` option — these are
    // deliberately NOT converted to Number, unlike the values above.
    accessExpiry: process.env.JWT_ACCESS_EXPIRY,
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY,
  },

  email: {
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
  },

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS),
    maxAttempts: Number(process.env.RATE_LIMIT_MAX_ATTEMPTS),
  },

  fraud: {
    largeTxnThreshold: Number(process.env.FRAUD_LARGE_TXN_THRESHOLD),
  },
};

// Default export: other files will write `import config from './config.js'`
// and then use config.server.port, config.database.host, and so on.
export default config;