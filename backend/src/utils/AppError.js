// src/utils/AppError.js
//
// WHY THIS FILE EXISTS: see the explanation above this code block — in
// short, this class lets us mark an error as "we expected this, it's safe
// to describe to the client" versus an unmarked error, which the future
// centralized error handler will treat as an unexpected failure and hide
// the details of.

// "extends Error" means AppError IS an Error — it inherits everything a
// normal Error already has (a .message property, a .stack trace, and it
// works correctly with try/catch, instanceof checks, etc.) and then adds
// our own extra properties on top.
class AppError extends Error {
  // The constructor runs every time we do `new AppError(...)` somewhere
  // in the app. It takes two pieces of information:
  //   - message: what went wrong, in plain English, safe to show a user
  //   - statusCode: which HTTP status this error should produce
  //     (defaults to 500 if not specified, since 500 = generic server error
  //     is the safest fallback if a caller forgets to specify one)
  constructor(message, statusCode = 500) {
    // super(message) calls the built-in Error class's own constructor,
    // which is what actually sets up `this.message` and `this.stack`.
    // This MUST be the first line in the constructor — JavaScript
    // requires it when extending a built-in class like Error.
    super(message);

    // Our own extra property: which HTTP status code this error maps to.
    // Examples we'll use in later milestones:
    //   400 Bad Request       — invalid input
    //   401 Unauthorized      — not logged in / bad credentials
    //   403 Forbidden         — logged in, but not allowed to do this
    //   404 Not Found         — the thing requested doesn't exist
    //   409 Conflict          — e.g. duplicate email on registration
    this.statusCode = statusCode;

    // This is the flag the future error handler checks. `true` here means
    // "this was thrown deliberately, by our own code, as a known business
    // rule — safe to show `message` to the client." Anything thrown that
    // is NOT an AppError (a real bug, a library error) won't have this
    // property at all, which the error handler will treat as "unexpected,
    // hide the details."
    this.isOperational = true;

    // Captures a clean stack trace pointing at wherever `new AppError(...)`
    // was actually called in our code, rather than including these
    // constructor lines themselves in the trace — makes debugging easier,
    // since the stack trace shows YOUR code's location, not this file's.
    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;