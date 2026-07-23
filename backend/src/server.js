// src/server.js
//
// WHY THIS FILE EXISTS: this is the ONLY file in the entire codebase that
// calls app.listen(). Everything about HOW the application behaves once
// it's running — middleware, routes, error handling — lives in app.js.
// Everything about the process's LIFECYCLE — starting up safely, shutting
// down cleanly — lives here. That split is deliberate and explained in
// detail below.

import app from './app.js';
import config from './config/config.js';
import { pool, verifyConnection } from './config/database.js';
import logger from './utils/logger.js';

// Holds a reference to the running HTTP server once it's started, so the
// shutdown handlers further down can call server.close() on it. Declared
// here, at module scope, so it's accessible both inside startServer() and
// inside the shutdown handlers below.
let server;

// ============================================================================
// STARTUP SEQUENCE
//
// WHY WE VERIFY THE DATABASE BEFORE CALLING app.listen(): if we started
// accepting HTTP traffic before confirming the database is reachable,
// every request during that window would fail with a confusing error deep
// inside some query — and the app would look "up" to anyone checking from
// outside, while actually being unable to do its job. Verifying first
// means the app either starts genuinely ready, or doesn't start at all.
// For a banking system, a service that clearly refuses to start is a much
// safer failure mode than one that starts and quietly misbehaves.
// ============================================================================
async function startServer() {
  try {
    // This throws (and, inside database.js, calls process.exit(1) itself)
    // if the database can't be reached — so if we get past this line, the
    // database is confirmed genuinely reachable, not just configured.
    await verifyConnection();

    // Only now, with the database confirmed, do we actually start
    // accepting HTTP connections. config.server.port comes from our
    // validated, numeric config object — never a raw, unchecked
    // process.env read.
    server = app.listen(config.server.port, () => {
      logger.info(
        `BankGuard backend listening on port ${config.server.port} (${config.server.nodeEnv})`
      );
    });
  } catch (error) {
    // In practice, verifyConnection() already calls process.exit(1) on
    // failure (see database.js), so this catch block is a defensive
    // backstop for any OTHER unexpected failure during startup (e.g. the
    // configured port already being in use). Either way, the principle is
    // the same: log clearly, then refuse to continue in a broken state.
    logger.error(`Server failed to start: ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// GRACEFUL SHUTDOWN
//
// WHY THIS MATTERS: when you stop the server with Ctrl+C (SIGINT), or when
// a process manager / container orchestrator stops it in production
// (SIGTERM), the DEFAULT behavior is for Node to terminate immediately —
// killing any in-flight HTTP requests mid-response, and abandoning any
// MySQL connections in the pool without closing them cleanly. For a
// banking application, abruptly cutting off a request that might be
// halfway through a transaction is exactly the kind of thing we've spent
// this whole project trying to prevent.
//
// Graceful shutdown instead does three things, in order:
//   1. Stop accepting NEW connections (server.close())
//   2. Let any IN-FLIGHT requests finish naturally
//   3. Only then close the database pool and exit the process
// ============================================================================
async function shutdown(signal) {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  if (!server) {
    // Defensive case: if shutdown is somehow triggered before the server
    // ever finished starting, there's nothing to close — exit directly.
    process.exit(0);
  }

  // server.close() stops Node from accepting any NEW incoming connections,
  // but does NOT terminate existing ones — it waits for them to finish,
  // and only calls its callback once every in-flight request has
  // completed. This is the mechanism that protects a request that's
  // mid-transaction from being cut off.
  server.close(async () => {
    logger.info('HTTP server closed — no longer accepting new connections.');

    try {
      // Only after the HTTP server is fully closed do we close the
      // database pool. Closing it earlier could pull the database out
      // from under a request that server.close() is still waiting to
      // finish.
      await pool.end();
      logger.info('Database connection pool closed.');
      process.exit(0); // 0 = clean, deliberate exit
    } catch (error) {
      logger.error(`Error while closing database pool: ${error.message}`);
      process.exit(1); // 1 = exited due to an error during shutdown itself
    }
  });
}

// SIGINT: sent when you press Ctrl+C in the terminal running the server.
// SIGTERM: sent by process managers, container orchestrators (Docker,
// Kubernetes), or deployment tools asking a process to stop cleanly —
// this is the "please shut down" signal used in real production
// environments, as opposed to SIGKILL, which cannot even be intercepted
// and terminates immediately with no chance to clean up.
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start everything.
startServer();