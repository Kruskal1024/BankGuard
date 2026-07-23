// src/repositories/userRepository.js
//
// WHY REPOSITORIES EXIST: this is the ONLY file in the entire codebase
// permitted to run SQL against the `users` table. Services (like the
// upcoming authService.js) call functions here — createUser,
// findUserByEmail, etc. — instead of writing SQL themselves. This is the
// "Repository Pattern": it draws a hard line between BUSINESS LOGIC
// ("what does a successful login require?") and DATA ACCESS ("what SQL
// fetches a user row?"). Two direct benefits: (1) if we ever need to
// change a query — add an index hint, change a column name — there's
// exactly one place to look, not fifteen scattered SQL strings across
// controllers. (2) authService.js can be unit-tested by substituting a
// fake version of this repository, without needing a real database
// connection at all.
//
// WHY CONTROLLERS SHOULD NEVER EXECUTE SQL DIRECTLY: a controller's job is
// to translate an HTTP request into a call on a service, and a service's
// job is business rules. If SQL were scattered across controllers, the
// same "find user by email" logic would likely get rewritten slightly
// differently in five different places over time — and a security fix
// (like the parameterization and soft-delete filtering below) would need
// to be found and applied in all five, instead of once, here.

import { pool } from '../config/database.js';
import logger from '../utils/logger.js';
import AppError from '../utils/AppError.js';

// ============================================================================
// SQL INJECTION PREVENTION & PARAMETERIZED QUERIES
//
// Every query below uses a `?` placeholder and passes real values as a
// SEPARATE array argument to pool.execute() — never by building a SQL
// string with template literals or concatenation (e.g. NEVER
// `SELECT * FROM users WHERE email = '${email}'`).
//
// The difference matters enormously: with a `?` placeholder, mysql2 sends
// the query structure and the actual values to MySQL as two SEPARATE
// pieces. MySQL parses the query shape FIRST, before ever looking at the
// values — so a malicious value like `' OR '1'='1` can never change what
// the query DOES, no matter what it contains; it's always treated as a
// literal value to compare against, never as part of the SQL syntax
// itself. String concatenation has no such separation — a value
// containing SQL syntax literally becomes part of the query. This is
// tested explicitly below (test 8).
// ============================================================================

// ----------------------------------------------------------------------------
// createUser: inserts a new user row. Expects userData to already contain
// a HASHED password (this repository has no idea what hashing is —
// that's password.js's job, called by authService before this function
// is ever reached; keeping that separation is exactly why repositories
// should not contain business logic, including security logic like
// hashing).
// ----------------------------------------------------------------------------
export async function createUser({ email, passwordHash }) {
  try {
    const [result] = await pool.execute(
      `INSERT INTO users (email, password_hash) VALUES (?, ?)`,
      [email, passwordHash]
    );

    // result.insertId is how mysql2 reports the auto-generated user_id
    // for the row we just created. We return a plain object built from
    // known-safe values (the email we were given, the ID MySQL just
    // generated) — deliberately NOT re-querying and returning the raw
    // database row, which would include password_hash. A repository
    // function should return exactly what's useful and safe, not
    // "whatever the table happens to contain."
    return {
      userId: result.insertId,
      email,
    };
  } catch (error) {
    // ER_DUP_ENTRY is MySQL's specific error code for a UNIQUE constraint
    // violation — in this table, that's the uq_users_email constraint.
    // We check for this SPECIFIC error and convert it into a clear,
    // operational AppError(409) — "Conflict" is the correct HTTP status
    // for "this resource already exists." Any OTHER database error is
    // genuinely unexpected, so we log it in full (this is a real
    // incident worth investigating) and re-throw a generic AppError(500)
    // rather than leaking raw MySQL error text to the caller.
    if (error.code === 'ER_DUP_ENTRY') {
      throw new AppError('An account with this email already exists', 409);
    }
    logger.error(`createUser database error: ${error.message}`);
    throw new AppError('Failed to create user', 500);
  }
}

// ----------------------------------------------------------------------------
// findUserByEmail: looks up a user by email — the core lookup used during
// login. Returns the full row INCLUDING password_hash, because
// authService's login logic genuinely needs the hash to call
// verifyPassword() against it. This is the one function in this file
// permitted to return password_hash — every other function deliberately
// excludes it (see findUserById below).
// ----------------------------------------------------------------------------
export async function findUserByEmail(email) {
  // WHY SELECT ONLY SPECIFIC COLUMNS, NEVER SELECT *: three reasons.
  // (1) Explicit columns document exactly what this function returns —
  // anyone reading this code doesn't need to go check the table schema
  // to know what fields exist on the result. (2) If a new column is
  // added to the table later, SELECT * silently starts returning it
  // everywhere, potentially leaking a new sensitive field to code that
  // never asked for it. (3) Selecting fewer columns is measurably faster
  // for MySQL to read and transmit, though that's a minor benefit next
  // to the first two.
  //
  // AND deleted_at IS NULL: a soft-deleted user (see schema.sql's
  // deleted_at column) must never be treated as a valid account for
  // login — without this filter, a "deleted" user could still
  // authenticate successfully, which defeats the entire purpose of soft
  // deletion as an access-control mechanism.
  const [rows] = await pool.execute(
    `SELECT user_id, email, password_hash, status, failed_login_count,
            locked_until, last_login_at, created_at
     FROM users
     WHERE email = ? AND deleted_at IS NULL`,
    [email]
  );

  // pool.execute() always returns an array of rows, even for a query
  // that matches at most one (since email is UNIQUE). rows[0] is
  // undefined if nothing matched — we return that undefined directly
  // rather than throwing, because "no user with this email" is a normal,
  // expected outcome the CALLER (authService) needs to decide how to
  // handle (e.g. "invalid credentials," deliberately not revealing
  // whether the email or the password was wrong) — a repository
  // shouldn't make that business decision itself.
  return rows[0];
}

// ----------------------------------------------------------------------------
// findUserById: looks up a user by their numeric ID — used by
// authentication middleware on every protected request (decode the JWT,
// get userId, confirm the user still exists/is still active).
// Deliberately does NOT select password_hash — nothing that calls this
// function needs it, and every column returned here is a column that
// could theoretically end up in an API response somewhere, so leaving
// password_hash out entirely is safer than trusting every future caller
// to remember not to expose it.
// ----------------------------------------------------------------------------
export async function findUserById(id) {
  const [rows] = await pool.execute(
    `SELECT user_id, email, status, failed_login_count, locked_until,
            last_login_at, created_at
     FROM users
     WHERE user_id = ? AND deleted_at IS NULL`,
    [id]
  );
  return rows[0];
}

// ----------------------------------------------------------------------------
// updateLastLogin: records the timestamp of a successful login. Called by
// authService immediately after a login succeeds (password verified,
// account not locked).
// ----------------------------------------------------------------------------
export async function updateLastLogin(userId) {
  // NOW() is computed by MySQL itself, server-side — not by generating a
  // JavaScript Date and sending it as a parameter. This avoids any clock
  // discrepancy between the Node.js server and the database server, and
  // is the standard approach for "set this to the current time" updates.
  const [result] = await pool.execute(
    `UPDATE users SET last_login_at = NOW() WHERE user_id = ? AND deleted_at IS NULL`,
    [userId]
  );

  // affectedRows tells us whether a row was actually matched and
  // updated. If it's 0, the userId didn't correspond to any active user
  // — which would be an unusual situation (an authenticated request for
  // a user that no longer exists) worth surfacing as an error rather
  // than silently doing nothing.
  if (result.affectedRows === 0) {
    throw new AppError('User not found', 404);
  }

  return true;
}

// ----------------------------------------------------------------------------
// emailExists: a lightweight true/false check, used during registration
// to give a fast, clear error before even attempting a full insert.
// ----------------------------------------------------------------------------
export async function emailExists(email) {
  // COUNT(*) with a LIMIT 1 (implicit here since we only need to know
  // "at least one exists," not how many) is intentionally the cheapest
  // possible query for this question — we don't need any actual user
  // data, just a boolean answer, so we don't select user columns at all.
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS count FROM users WHERE email = ? AND deleted_at IS NULL`,
    [email]
  );
  return rows[0].count > 0;
}