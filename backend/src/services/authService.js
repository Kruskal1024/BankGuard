// src/services/authService.js
//
// WHY THIS FILE EXISTS: this is where the actual RULES of registration and
// login live — "a duplicate email is rejected," "5 failed logins locks the
// account," "a successful login resets the failure counter." Controllers
// (built in an upcoming file) will be thin — they'll just call
// authService.register(...) or authService.login(...) and shape the HTTP
// response. This file, in turn, never touches SQL directly (that's
// userRepository's job) and never touches the argon2 or jsonwebtoken
// libraries directly (that's password.js's and jwt.js's job). Each layer
// only knows about the layer directly below it — this is the layered
// architecture (routes → controllers → services → repositories) from the
// original Phase 1 design.
//
// KNOWN, DELIBERATE SCOPE LIMITATION (see the compatibility review above
// this code): tokens issued here carry { userId, email } only — no `role`
// claim yet, since no repository exists yet to look up a user's assigned
// role. Anything checking req.user.role in a future file will not work
// until role integration is built as an explicit next step.

import {
  findUserByEmail,
  findUserById,
  createUser,
  emailExists,
  updateLastLogin,
  recordFailedLogin,
  resetFailedLoginAttempts,
} from '../repositories/userRepository.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt.js';
import AppError from '../utils/AppError.js';
import logger from '../utils/logger.js';

// ----------------------------------------------------------------------------
// A small internal helper, not exported: strips password_hash and any
// other sensitive/internal field off a user object before it's ever
// allowed to leave this service. Used by both register() and login()
// so there is exactly ONE place that decides "this is what a user object
// looks like from the outside" — no controller ever has to remember to
// do this scrubbing itself.
// ----------------------------------------------------------------------------
function toSafeUser(user) {
  return {
    userId: user.userId ?? user.user_id,
    email: user.email,
    status: user.status,
    lastLoginAt: user.last_login_at ?? null,
  };
}

// ============================================================================
// register: creates a new user account.
// ============================================================================
export async function register({ email, password }) {
  // WHY CHECK emailExists() BEFORE ALSO RELYING ON createUser's own
  // ER_DUP_ENTRY handling (built into userRepository.js): this isn't
  // redundant, it's defense in depth against a real race condition. If
  // two registration requests for the same email arrive at almost the
  // same instant, both could pass this emailExists() check before either
  // has actually inserted a row — but the database's UNIQUE constraint on
  // email is the ultimate, unbeatable source of truth, and createUser's
  // ER_DUP_ENTRY handling catches that scenario even if this earlier
  // check was fooled by the race. This check exists purely to give a
  // fast, clean error in the OVERWHELMINGLY common case (someone simply
  // already has an account) without needing to attempt and fail an
  // insert first.
  const alreadyExists = await emailExists(email);
  if (alreadyExists) {
    throw new AppError('An account with this email already exists', 409);
  }

  // Hashing happens HERE, in the service layer — not in the repository
  // (which only knows SQL) and not in the controller (which only knows
  // HTTP). This is exactly the kind of business/security rule that
  // belongs in a service: "a password must be hashed before storage" is
  // a decision about HOW registration works, not about data access or
  // HTTP shaping.
  const passwordHash = await hashPassword(password);

  const newUser = await createUser({ email, passwordHash });

  logger.info(`New user registered: userId=${newUser.userId}`);

  // createUser only returns { userId, email } — it doesn't re-query the
  // full row. We explicitly set status: 'active' here rather than
  // passing newUser straight into toSafeUser(), because a freshly
  // inserted user's status is always 'active' (the column's own DEFAULT
  // in schema.sql) — this is a known, correct fact at this exact point
  // in the code, not a guess. Passing newUser directly would have left
  // toSafeUser() looking for a status field that was never actually
  // returned by createUser, producing `status: undefined` in the
  // response — caught by testing, not just reasoning about the code.
  return toSafeUser({ ...newUser, status: 'active' });
}

// ============================================================================
// login: verifies credentials and issues tokens.
// ============================================================================
export async function login({ email, password }) {
  const user = await findUserByEmail(email);

  // ----------------------------------------------------------------------
  // WHY THE "USER NOT FOUND" CASE THROWS THE EXACT SAME MESSAGE AS "WRONG
  // PASSWORD": if a "no such email" error looked different from a "wrong
  // password" error, an attacker could use the login endpoint to discover
  // which email addresses have accounts at all — a real privacy/security
  // leak called a "user enumeration" vulnerability. Both failure paths
  // below throw the identical AppError('Invalid email or password', 401)
  // — same message, same status code — specifically so an outside
  // observer cannot distinguish "that email doesn't exist" from "that
  // email exists but the password was wrong."
  // ----------------------------------------------------------------------
  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  // ----------------------------------------------------------------------
  // ACCOUNT LOCKOUT CHECK (FR-AUTH-06): if locked_until is set AND still
  // in the future, the account is currently locked — reject the login
  // attempt WITHOUT even checking the password. This is deliberate: while
  // locked, we don't want to give an attacker any further signal (e.g. a
  // different response for "locked + right password" vs. "locked + wrong
  // password" would itself leak information about whether they'd guessed
  // correctly).
  // ----------------------------------------------------------------------
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError(
      'Account is temporarily locked due to multiple failed login attempts. Please try again later.',
      423 // 423 Locked — the specific HTTP status for "the resource is locked"
    );
  }

  // Also reject login for accounts a staff member has explicitly
  // suspended (status = 'suspended') — a deliberate administrative
  // action, distinct from the automatic, temporary lockout above.
  if (user.status === 'suspended') {
    throw new AppError('This account has been suspended. Please contact support.', 403);
  }

  const passwordMatches = await verifyPassword(user.password_hash, password);

  if (!passwordMatches) {
    // Record the failure BEFORE throwing — if we threw first, this line
    // would never run, and failed attempts would never actually be
    // counted, silently defeating FR-AUTH-06 entirely.
    await recordFailedLogin(user.user_id);
    throw new AppError('Invalid email or password', 401);
  }

  // Password was correct: clear any previous failed-attempt history and
  // record this successful login.
  await resetFailedLoginAttempts(user.user_id);
  await updateLastLogin(user.user_id);

  logger.info(`User logged in: userId=${user.user_id}`);

  // See the file-level comment: no role claim yet, deliberately.
  const tokenPayload = { userId: user.user_id, email: user.email };
  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);

  return {
    user: toSafeUser(user),
    accessToken,
    refreshToken,
  };
}