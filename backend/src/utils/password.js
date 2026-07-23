// src/utils/password.js
//
// WHY THIS FILE EXISTS: this is the ONLY place in the codebase that calls
// argon2 directly. The user repository and auth service will call
// hashPassword() and verifyPassword() from here instead of using the
// argon2 library themselves — so if we ever need to tune hashing
// parameters, upgrade the algorithm, or add password-rehashing logic,
// there's exactly one file to change.

import argon2 from 'argon2';
import logger from './logger.js';

// ============================================================================
// WHY ARGON2, AND WHY THESE SPECIFIC OPTIONS
//
// Argon2 won the Password Hashing Competition (2015) and is the current
// OWASP-recommended algorithm for password storage — it's specifically
// designed to resist both GPU-based cracking (unlike older algorithms like
// plain SHA-256, which GPUs can compute billions of times per second) and
// side-channel timing attacks.
//
// There are three Argon2 variants: argon2i, argon2d, and argon2id.
// argon2id is a hybrid, and is what OWASP specifically recommends for
// password storage — it resists both the GPU-cracking attacks argon2i is
// designed against AND the side-channel attacks argon2d is designed
// against, at the cost of neither variant's individual weaknesses.
//
// We set these parameters EXPLICITLY rather than relying on the library's
// own defaults, for two reasons:
//   1. Explicit configuration means we know exactly what security level
//      we're getting, rather than trusting a default that might change
//      between library versions.
//   2. These specific values match OWASP's current minimum recommended
//      configuration for argon2id (memoryCost 19 MiB, timeCost 2,
//      parallelism 1) — a deliberate, documented security decision, not
//      a guess.
// ============================================================================
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB — how much memory the hash function must use; higher = harder to crack in parallel on GPUs
  timeCost: 2,        // number of iterations; higher = slower to compute, both for us and for an attacker
  parallelism: 1,      // number of parallel threads used while hashing
};

// ----------------------------------------------------------------------------
// hashPassword: turns a plaintext password into a safe-to-store hash.
//
// Called from the auth service during registration, and during password
// changes/resets later in the project.
// ----------------------------------------------------------------------------
export async function hashPassword(plainPassword) {
  // We deliberately do NOT log the plaintext password anywhere, at any
  // log level, under any circumstance — not even in a debug log. This
  // function receiving it at all is the one moment it exists in memory;
  // it should never be written to disk, a log file, or a log aggregation
  // service in readable form.
  try {
    // argon2.hash() does two things in one call: it generates a
    // cryptographically random SALT (extra random data mixed into the
    // password before hashing, so two users with the same password get
    // completely different hashes — this is what stops "rainbow table"
    // attacks), and it returns a single string containing the algorithm,
    // parameters, salt, AND the hash all together — so verifyPassword()
    // later doesn't need us to separately store the salt or parameters
    // ourselves; they're embedded in the one string we save to the
    // database's password_hash column.
    const hash = await argon2.hash(plainPassword, HASH_OPTIONS);
    return hash;
  } catch (error) {
    // A hashing failure here is almost always an environment problem
    // (e.g. genuinely out of memory) rather than anything about the
    // password itself — but either way, we log it as a real error and
    // re-throw, rather than silently returning something unsafe. Letting
    // registration fail loudly is much safer than accidentally storing an
    // unhashed password because of a swallowed error.
    logger.error(`Password hashing failed: ${error.message}`);
    throw error;
  }
}

// ----------------------------------------------------------------------------
// verifyPassword: checks a plaintext password (typed at login) against a
// previously stored hash. Returns true/false — it deliberately never
// throws for "wrong password," only for genuine unexpected failures.
// ----------------------------------------------------------------------------
export async function verifyPassword(hash, plainPassword) {
  try {
    // argon2.verify() reads the algorithm and parameters back out of the
    // hash string itself (the ones embedded by hashPassword above), so it
    // always checks using the exact same settings the password was
    // originally hashed with — even if HASH_OPTIONS above changes in the
    // future, old hashes still verify correctly against their original
    // parameters.
    const isMatch = await argon2.verify(hash, plainPassword);
    return isMatch;
  } catch (error) {
    // argon2.verify() throws if the hash string itself is malformed —
    // for example, if the database somehow contains a corrupted or
    // non-argon2 value. This should be rare, but if it happens, the SAFE
    // behavior is to treat it as "does not match," not to crash the login
    // request or, worse, to accidentally treat a broken hash as a
    // successful login. We log it (this points to a data problem worth
    // investigating) but return false, not throw.
    logger.error(`Password verification error (treated as non-match): ${error.message}`);
    return false;
  }
}