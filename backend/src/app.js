// src/app.js
//
// WHY THIS FILE EXISTS: this is where the Express application is actually
// assembled — middleware configured, routes registered, the error pipeline
// wired together. It deliberately does NOT call app.listen() — that's
// server.js's job (built next). This separation means a future test suite
// can import this file directly and send it fake requests in-process,
// without opening a real network port.

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import morgan from 'morgan';

import config from './config/config.js';
import logger from './utils/logger.js';
import notFound from './middleware/notFound.js';
import errorHandler from './middleware/errorHandler.js';

const app = express();

// ============================================================================
// 1. SECURITY MIDDLEWARE — registered first and early, so security headers
// are present on every response, including ones generated later by the
// error handler.
// ============================================================================

// helmet() sets a collection of HTTP headers that harden the app against
// several common attacks (e.g. X-Content-Type-Options prevents MIME-sniffing
// attacks, X-Frame-Options helps prevent clickjacking). One line, broad
// protection — this is the OWASP-recommended baseline for any Express app.
app.use(helmet());

// CORS (Cross-Origin Resource Sharing) controls which frontend origins are
// allowed to call this API from a browser. Without this, a browser blocks
// your own Angular frontend (running on a different port) from calling this
// backend at all — CORS isn't optional configuration, it's required for
// your own frontend to work, not just a security nicety.
//
// config.cors.allowedOrigins is already a parsed array (config.js splits
// the comma-separated .env value once, so every consumer gets clean data).
app.use(
  cors({
    origin: config.cors.allowedOrigins,
    credentials: true, // allows cookies to be sent cross-origin, needed once refresh-token cookies exist
  })
);

// Rate limiting caps how many requests a single IP can make in a given time
// window, using the exact values from config.rateLimit (already validated
// and converted to numbers by config.js). This is our first line of defense
// against brute-force login attempts and basic denial-of-service abuse.
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxAttempts,
  standardHeaders: true, // returns rate-limit info in standard RateLimit-* headers
  legacyHeaders: false, // disables the older, non-standard X-RateLimit-* headers
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
  },
});
app.use(limiter);

// ============================================================================
// 2. COOKIE PARSING — needed before any route/middleware that reads
// req.cookies. Passing a secret enables SIGNED cookies (req.signedCookies),
// which detect if a cookie's value was tampered with client-side.
// ============================================================================
app.use(cookieParser(config.cookie.secret));

// ============================================================================
// 3. COMPRESSION — gzips response bodies before sending them, reducing
// bandwidth for larger JSON responses (e.g. transaction history, reports).
// Cheap to enable, meaningful savings on anything beyond small payloads.
// ============================================================================
app.use(compression());

// ============================================================================
// 4. BODY PARSERS — must come before any route that reads req.body.
// A 10kb limit is a deliberate guard: this API should never legitimately
// receive a JSON body anywhere near that size at this stage of the project;
// an oversized payload is either a mistake or an abuse attempt.
// ============================================================================
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ============================================================================
// 5. REQUEST LOGGING — morgan captures standard HTTP request metadata
// (method, URL, status, response time); its output is piped through our
// Winston logger instead of morgan's own console output, so every log line
// in the app — from any source — goes through the same formatting logic.
// ============================================================================
const morganStream = {
  write: (message) => logger.info(message.trim()),
};
app.use(morgan('combined', { stream: morganStream }));

// ============================================================================
// 6. ROUTES
//
// The health check is defined inline here for now, since no route files
// exist yet. Once src/routes/v1/ is built in a later file, this will move
// there and this section will instead just do:
//   app.use('/api/v1/auth', authRoutes);
//   app.use('/api/v1/health', healthRoutes);
//   etc.
// ============================================================================
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'BankGuard API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Placeholders — uncommented and filled in as each route file is built in
// upcoming milestones:
// app.use('/api/v1/auth', authRoutes);
// app.use('/api/v1/users', userRoutes);
// app.use('/api/v1/accounts', accountRoutes);
// app.use('/api/v1/transactions', transactionRoutes);

// ============================================================================
// 7. 404 HANDLER — must come AFTER every real route above. Anything that
// reaches this point matched none of them.
// ============================================================================
app.use(notFound);

// ============================================================================
// 8. CENTRALIZED ERROR HANDLER — must be registered LAST. Express identifies
// it as an error handler by its four-parameter signature and routes every
// next(error) call here, from anywhere earlier in the chain.
// ============================================================================
app.use(errorHandler);

// Exported, not started. server.js imports this and calls app.listen(...)
// after verifying the database connection.
export default app;
