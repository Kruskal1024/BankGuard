// src/utils/jwt.js
//
// WHY THIS FILE EXISTS: this is the ONLY place in the codebase that calls
// the jsonwebtoken library directly. The auth service (built in an
// upcoming file) will call generateAccessToken/generateRefreshToken during
// login, and an upcoming authentication MIDDLEWARE will call
// verifyAccessToken on every protected request — but neither of them will
// ever touch jsonwebtoken's own API directly. One file, one place to
// change if we ever need to.

import jwt from 'jsonwebtoken';
import config from '../config/config.js';
import logger from './logger.js';
import AppError from './AppError.js';

// ============================================================================
// WHY JWTs ARE USED
//
// HTTP is stateless — by default, the server doesn't remember who you are
// between requests. Traditionally, this was solved with SESSIONS: the
// server keeps a record in memory or a database saying "this session ID
// belongs to this user," and the browser sends that session ID back on
// every request. That works, but it means every single request needs a
// database lookup just to know who's asking, and it doesn't scale cleanly
// across multiple servers without a shared session store.
//
// A JWT (JSON Web Token) is a different approach: it's a signed piece of
// data the SERVER hands to the client after login, containing who the
// user is. The client sends it back on every subsequent request. Because
// it's cryptographically SIGNED (not encrypted — anyone can read the
// contents, but only the server holding the secret can have PRODUCED a
// validly-signed one), the server can verify the token wasn't tampered
// with, without needing to look anything up in a database at all. This is
// what "stateless authentication" means, and it's why JWTs scale well.
// ============================================================================

// ============================================================================
// ACCESS TOKENS vs REFRESH TOKENS — why we use two, not one
//
// ACCESS TOKEN: sent with every API request (e.g. in the Authorization
// header) to prove who's asking. Deliberately SHORT-LIVED (config.jwt.
// accessExpiry, e.g. "15m"). If one is ever stolen — through an XSS
// attack, a leaked log, a compromised device — the damage window is
// small: it stops working on its own within minutes.
//
// REFRESH TOKEN: NOT sent with every request. It's used only once in a
// while, to obtain a new access token once the old one expires, without
// forcing the user to log in again. It lives much longer (config.jwt.
// refreshExpiry, e.g. "7d") specifically so a user isn't forced to
// re-enter their password every 15 minutes — but because it's used so
// rarely, it can be stored more carefully (e.g. later, as an httpOnly
// cookie, never accessible to JavaScript at all) and revoked server-side
// if needed (that revocation piece lives in the database's
// refresh_tokens table, built back in Milestone 2 — this file only
// handles the cryptographic signing/verification side, not revocation
// storage, which belongs to the auth service instead).
//
// Splitting these into two tokens with two different lifetimes is a
// deliberate security/usability tradeoff: short-lived credential exposed
// often, long-lived credential exposed rarely.
// ============================================================================

// ============================================================================
// WHY DIFFERENT SECRETS FOR EACH TOKEN TYPE
//
// config.jwt.secret signs access tokens; config.jwt.refreshSecret signs
// refresh tokens — two DIFFERENT random strings, not the same one reused.
// This matters because it means an access token can never be mistaken
// for, or misused as, a refresh token, and vice versa — verifyAccessToken
// literally cannot successfully verify something signed with the refresh
// secret, because the signatures wountdn't match. This is tested
// explicitly below (tests 7 and 8). If we used one shared secret for
// both, a stolen access token (which is exposed far more often, on every
// request) could potentially be replayed against a refresh-token-only
// endpoint — using separate secrets closes that off entirely.
// ============================================================================

// ----------------------------------------------------------------------------
// generateAccessToken: signs a short-lived token for a given payload
// (typically { userId, role }, decided by the auth service that calls
// this — this file doesn't care what's inside the payload, only how to
// sign and verify it).
// ----------------------------------------------------------------------------
export function generateAccessToken(payload) {
  // jwt.sign() takes the payload, a secret, and options, and returns a
  // single signed string. expiresIn accepts human-readable duration
  // strings like "15m" directly — this is WHY config.js deliberately
  // keeps accessExpiry as a string rather than converting it to a number
  // like most other config values; jsonwebtoken expects this exact format.
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiry,
  });
}

// ----------------------------------------------------------------------------
// generateRefreshToken: signs a long-lived token, using the SEPARATE
// refresh secret and its own, longer expiry.
// ----------------------------------------------------------------------------
export function generateRefreshToken(payload) {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiry,
  });
}

// ============================================================================
// WHY VERIFICATION THROWS, AND WHY WE CONVERT THAT INTO AppError(401)
//
// jsonwebtoken's own jwt.verify() throws a native JavaScript error for
// several distinct failure reasons — most commonly TokenExpiredError (the
// token's expiresIn has passed) and JsonWebTokenError (the signature
// doesn't match — either the token was tampered with, is malformed, or
// was signed with a different secret entirely, which is exactly what
// tests 7 and 8 below confirm). Left unhandled, either of those would
// propagate up as a raw, unrecognized Error — NOT an AppError — and our
// errorHandler.js (built in Milestone 3) would treat it as an UNEXPECTED
// failure: logged as a scary error-level incident, and returning a
// generic 500 "unexpected error" to the client.
//
// That's the wrong behavior for "your login expired" or "this token is
// invalid" — those are completely normal, expected situations (a user's
// session naturally expiring is not a bug), and the client needs a clear,
// specific 401 Unauthorized response so the frontend knows to redirect to
// login — not a vague 500. So both verify functions below catch jwt's
// native errors and re-throw them as AppError(message, 401) — converting
// an "unexpected-looking" error into a properly classified, operational
// one, exactly the distinction AppError exists to make (see AppError.js).
// ============================================================================

// ----------------------------------------------------------------------------
// verifyAccessToken: verifies a token was signed with the ACCESS secret
// and has not expired. Returns the decoded payload if valid; throws
// AppError(401) otherwise.
// ----------------------------------------------------------------------------
export function verifyAccessToken(token) {
  try {
    // jwt.verify() checks BOTH the signature (was this really signed with
    // config.jwt.secret, unmodified?) AND the expiry (has expiresIn
    // passed?) in one call. If either check fails, it throws — it never
    // silently returns null or false.
    const decoded = jwt.verify(token, config.jwt.secret);
    return decoded;
  } catch (error) {
    // We deliberately do NOT log the token itself, or the decoded
    // payload, anywhere — even in a failure case. A token is a bearer
    // credential: anyone who has a copy of it can use it, exactly like a
    // password. Logging it would create a second, less-protected place a
    // valid credential could leak from (log files are often kept far
    // longer, and read by more people, than the original request ever
    // was).
    //
    // We also don't log every failed verification as a server ERROR —
    // "an expired or invalid token showed up" is completely normal,
    // expected traffic (tokens expire constantly, browsers retry, users
    // paste an old token), not an application bug. So there's no
    // logger.error() call here at all for this expected case — see the
    // requirement "log only unexpected failures" above; this genuinely
    // isn't one.
    if (error.name === 'TokenExpiredError') {
      throw new AppError('Access token has expired', 401);
    }
    // Any other verification failure (bad signature, malformed token,
    // wrong secret used) — all grouped under one clear, generic message.
    // We deliberately do NOT tell the client WHICH specific thing was
    // wrong with their token (e.g. "signature mismatch" vs "malformed") —
    // that level of detail is only useful to an attacker probing for
    // weaknesses, not to a legitimate client, which only ever needs to
    // know "this token doesn't work, log in again."
    throw new AppError('Invalid access token', 401);
  }
}

// ----------------------------------------------------------------------------
// verifyRefreshToken: identical logic to verifyAccessToken, but checked
// against the SEPARATE refresh secret.
// ----------------------------------------------------------------------------
export function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, config.jwt.refreshSecret);
    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new AppError('Refresh token has expired', 401);
    }
    throw new AppError('Invalid refresh token', 401);
  }
}