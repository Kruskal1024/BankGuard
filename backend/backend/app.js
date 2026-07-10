// app.js — Express application definition (no server binding here).
//
// Kept separate from server.js deliberately: app.js exports a configured
// Express instance so it can be imported directly by tests (supertest can
// hit the app without opening a real network port). server.js is the only
// file that calls .listen(). This separation is a standard pattern that
// makes integration testing dramatically simpler.
//
// Middleware and routes are registered here in Milestone 4 (Authentication)
// once there's something real to wire up. For now this is intentionally a
// skeleton — Milestone 2 scope is structure, not logic.

require('dotenv').config();
const express = require('express');

const app = express();

// --- Global middleware will be registered here in order (Milestone 4+):
// 1. helmet()                         — security headers
// 2. cors()                           — cross-origin policy
// 3. express.json()                   — body parsing
// 4. morgan + correlation-id logger   — request logging
// 5. rate limiter (auth routes)       — brute-force mitigation
//
// --- Versioned routes will be mounted here (Milestone 4+):
// app.use('/api/v1/auth', require('./src/routes/v1/auth.routes'));
// app.use('/api/v1/accounts', require('./src/routes/v1/accounts.routes'));
// ...
//
// --- Central error handler will be registered last (Milestone 4+).

module.exports = app;
