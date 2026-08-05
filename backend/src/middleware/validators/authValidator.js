// src/middleware/validators/authValidator.js
//
// WHY VALIDATION BELONGS BEFORE CONTROLLERS: this middleware runs in the
// Express chain BEFORE authController's registerController/loginController
// ever execute (that wiring happens in the route file, not built yet).
// This ordering matters — a controller has no way to "un-process" bad data
// once it's already been passed to authService. Catching a malformed email
// or a weak password HERE, before anything downstream even runs, means
// authService and userRepository never have to defend against garbage
// input reaching them — they can simply trust it's already been checked.
//
// WHY CONTROLLERS SHOULD ASSUME VALIDATED INPUT: authController's
// register()/login() functions (already built) read req.body.email and
// req.body.password directly, with no format checking of their own. That
// is not an oversight — it is only safe BECAUSE this validator runs
// first. This is a deliberate division of responsibility: this file
// answers "is the request well-formed?", authController answers "what do
// we do with a well-formed request?", and authService answers "what are
// the business rules?" Mixing those together into one file would make
// each of those three questions harder to test and reason about in
// isolation.
//
// WHY VALIDATION IS SEPARATE FROM BUSINESS LOGIC: "a password needs 12+
// characters with mixed case, a number, and a symbol" is a FORMAT rule —
// true regardless of anything about our specific database or business.
// "An account locks after 5 failed logins" is a BUSINESS rule — specific
// to how BankGuard behaves, already implemented in authService.js. Format
// rules belong here, close to the HTTP boundary, checked before we do any
// real work; business rules belong deeper in the service layer, where
// they can be enforced consistently no matter how they're triggered.
//
// WHY SANITIZATION HELPS SECURITY: beyond just checking format,
// .normalizeEmail() and .trim() below actively CHANGE the incoming data
// into a cleaner, more predictable form (lowercased domain, no stray
// whitespace) before it goes anywhere else in the app. This matters for
// more than tidiness — without normalization, "User@Example.com " and
// "user@example.com" could be treated as two different emails by a
// naive database lookup, potentially allowing a duplicate account to be
// created for what a human would consider "the same" address, or
// allowing a lookup to fail to find an existing account it should have
// matched.

import { body, validationResult } from 'express-validator';

// ============================================================================
// registerValidator: an ARRAY of middleware functions, not a single one.
// Express runs each entry in an array like this in sequence — one check
// per field/rule, which keeps each individual rule small, readable, and
// independently testable, rather than one giant validation function
// trying to check everything at once.
// ============================================================================
export const registerValidator = [
  body('email')
    .trim() // removes leading/trailing whitespace before any other check runs
    .notEmpty()
    .withMessage('Email is required')
    .bail() // stops running FURTHER checks on this field once one has already failed — avoids piling up confusing, redundant error messages for the same field
    .isEmail()
    .withMessage('Email must be a valid email address')
    .bail()
    .isLength({ max: 255 })
    .withMessage('Email must not exceed 255 characters')
    .normalizeEmail(), // lowercases the domain, removes dots from Gmail-style addresses where applicable, etc. — see the sanitization note above

  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .bail()
    .isLength({ min: 12, max: 128 })
    .withMessage('Password must be between 12 and 128 characters')
    .bail()
    // Each of the four checks below is a SEPARATE .matches() call rather
    // than one combined regular expression, deliberately — this way, if
    // a password fails multiple rules at once (e.g. no uppercase AND no
    // symbol), the user sees every specific rule they failed, not just
    // the first one a combined regex happened to catch. Better user
    // experience, and each rule reads clearly on its own line.
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number')
    .matches(/[^A-Za-z0-9]/)
    .withMessage('Password must contain at least one special character'),
  // Note: password is intentionally NOT .trim()'d — a leading or
  // trailing space could be a deliberate part of a password a user
  // chose, and silently stripping it would mean the password they typed
  // and the password we actually check against are no longer the same
  // string, which is a confusing, hard-to-diagnose bug for a real user
  // to run into.
];

// ============================================================================
// loginValidator: deliberately much lighter than registerValidator. Login
// only needs to confirm the request LOOKS like a login attempt (a
// present, valid-shaped email and a non-empty password) — it must NOT
// enforce the 12-character/complexity rules here. Those are RULES ABOUT
// CREATING a password, not about attempting to use one — and if we
// changed our password policy in the future (e.g. required 14 characters
// instead of 12), any EXISTING user with a perfectly valid, already-
// hashed 12-character password must still be able to log in. Applying
// registration-strength rules to login would lock out legitimate
// existing users over a policy that didn't exist when they signed up.
// ============================================================================
export const loginValidator = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .bail()
    .isEmail()
    .withMessage('Email must be a valid email address')
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  // No .isLength() or .matches() rules here — see the comment above.
];

// ============================================================================
// validate: the middleware that actually STOPS the request if any of the
// rules above failed. Placed after registerValidator/loginValidator in
// the route chain (route wiring happens in a later file, not this one).
//
// WHY THIS IS A SEPARATE, GENERIC FUNCTION rather than duplicated at the
// end of both arrays above: this exact "check for errors, return 400 if
// any exist" logic will be reused by EVERY future validator file in the
// project (user validators, transaction validators, and so on) — writing
// it once here and importing it everywhere keeps the error RESPONSE
// SHAPE consistent across the entire API, not just for auth endpoints.
// ============================================================================
export function validate(req, res, next) {
  // validationResult(req) reads the results that were quietly accumulated
  // by the .withMessage()-style checks above (they don't throw or stop
  // the request themselves — they just record failures onto the request
  // object as they run). This function is the one place that actually
  // reacts to those accumulated results.
  const errors = validationResult(req);

  // This deliberately does NOT need to be async, and does NOT need
  // asyncHandler — express-validator's checks and validationResult() are
  // synchronous by the time this function runs (the array of validators
  // ahead of it in the chain has already fully executed), so there's no
  // Promise here to catch, and no risk of an unhandled rejection this
  // function could produce.
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      // .array() converts express-validator's internal error collection
      // into a plain array of plain objects — safe to serialize directly
      // into JSON, and each entry already contains which field failed
      // and why (from our .withMessage() calls above).
      errors: errors.array(),
    });
  }

  // No errors: hand off to whatever's next in the chain — in the real
  // route file (not built yet), that will be authController's
  // registerController or loginController.
  next();
}