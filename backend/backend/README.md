# BankGuard backend

Secure enterprise banking fraud detection and security monitoring platform — backend service.

## Status

Milestone 2: project structure, database schema, and environment configuration. No business logic implemented yet — that begins at Milestone 4 (Authentication).

## Setup

```bash
cp .env.example .env      # then fill in real values — never commit .env
npm install
npm run dev                # requires nodemon, starts on PORT from .env
```

Database: run `schema.sql` against a MySQL 8+ / MariaDB 10.6+ instance before starting the server.

## Folder structure

| Folder | Purpose |
|---|---|
| `src/config/` | Environment loading, DB connection pool config, constants (fraud thresholds, JWT expiry) — the only place `process.env` is read directly |
| `src/routes/v1/` | Express route definitions only — no logic, just wiring `HTTP verb + path → controller function`. Versioned per the `/api/v1/` strategy in Phase 1 §7.5 |
| `src/controllers/` | Translates HTTP request/response into calls on services; owns status codes and response shaping, nothing else |
| `src/services/` | All business logic lives here — transaction rules, RBAC checks, fraud orchestration. Framework-agnostic and unit-testable without HTTP or a database |
| `src/repositories/` | The only layer that writes SQL. Services call repositories, never raw `mysql2` queries directly |
| `src/models/` | Data shape definitions / DTOs shared between layers |
| `src/middleware/` | Cross-cutting Express middleware: JWT verification, RBAC guards, error handler, audit logger, correlation ID injection |
| `src/validators/` | `express-validator` schemas, one file per resource |
| `src/security/` | Argon2 hashing helpers, JWT sign/verify helpers, rate-limit config |
| `src/fraud-engine/` | The fraud orchestrator and the `IScoringEngine`-style rule interface (Phase 1 §7.4). `rules/` holds individual rule implementations, one file per rule |
| `src/notifications/` | The notification service and its channel adapters. `channels/` holds one file per channel (email now; SMS/push slot in later without touching callers) |
| `src/utils/` | Small stateless helpers (formatters, ID generators) with no business meaning of their own |
| `src/logs/` | Log output directory for local development (gitignored contents) |
| `src/docs/` | Generated Swagger/OpenAPI spec output |
| `src/tests/unit/` | Service-layer tests — no HTTP, no real database |
| `src/tests/integration/` | Full-stack tests via `supertest` against `app.js` |

## Why `app.js` and `server.js` are separate

`app.js` exports a configured Express app but never calls `.listen()`. `server.js` is the only file that binds a port. This means integration tests can import `app.js` and hit it in-process — no real network socket, no port conflicts, faster test runs.
