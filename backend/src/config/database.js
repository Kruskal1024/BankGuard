// src/config/database.js
//
// WHY THIS FILE EXISTS: this is the ONLY place in the codebase that creates
// a MySQL connection pool. Every repository and service that needs to run
// a query imports the `pool` exported from here — none of them ever call
// mysql2's createPool() themselves. One pool, shared across the whole app,
// configured once.

import mysql from 'mysql2/promise';
import config from './config.js';
import logger from '../utils/logger.js';

// ----------------------------------------------------------------------------
// THE POOL
//
// createPool() does NOT connect to the database immediately — it just sets
// up a manager that will open real connections lazily, the first time
// something is actually queried. That's why we still need the separate
// verifyConnection() function below: creating the pool succeeding tells us
// nothing about whether the database is actually reachable.
// ----------------------------------------------------------------------------
export const pool = mysql.createPool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,

  // --- Enterprise defaults, explained ---

  // waitForConnections: true — if all connections in the pool are busy,
  // a new query request WAITS in a queue for one to free up, instead of
  // immediately throwing an error. For a banking app, a query failing
  // outright under a brief traffic spike (rather than just waiting a
  // few milliseconds) is the wrong tradeoff.
  waitForConnections: true,

  // connectionLimit: 10 — the maximum number of simultaneous connections
  // the pool will open to MySQL. Ten is a reasonable starting point for a
  // small-to-medium app; too high can overwhelm the database server, too
  // low creates a bottleneck under load. This is a number you'd tune based
  // on real load testing, not guess once and forget.
  connectionLimit: 10,

  // queueLimit: 0 — 0 means "unlimited queueing" rather than rejecting
  // requests once some fixed queue length is hit. Paired with
  // waitForConnections: true, this means requests wait rather than fail,
  // up to Node's own memory limits (which in practice is a very large
  // number of queued requests, far more than we'd realistically ever hit).
  queueLimit: 0,
});

// ----------------------------------------------------------------------------
// STARTUP VERIFICATION
//
// Runs one trivial query (SELECT 1) to confirm the database is genuinely
// reachable with the credentials provided — not just that the pool object
// was created without error (which, as noted above, proves nothing on its
// own). This function is meant to be called once, from server.js, BEFORE
// the app starts accepting HTTP traffic.
// ----------------------------------------------------------------------------
export async function verifyConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query('SELECT 1');
    logger.info('Database connection verified successfully');
  } catch (error) {
    logger.error(`Database connection failed: ${error.message}`);
    // process.exit(1): refuse to continue starting the app at all. A
    // banking backend that starts and accepts requests while unable to
    // reach its own database would fail confusingly, request by request,
    // instead of failing once, loudly, at boot.
    process.exit(1);
  } finally {
    // Always release the connection back to the pool, whether the query
    // succeeded or failed — otherwise this one connection stays "checked
    // out" forever, slowly shrinking the pool's real capacity over time.
    if (connection) connection.release();
  }
}