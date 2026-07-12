// src/utils/asyncHandler.js
//
// WHY THIS FILE EXISTS: Express does not automatically catch errors thrown
// inside an `async` route handler. If a controller does something like:
//
//   router.get('/accounts/:id', async (req, res) => {
//     const account = await accountService.findById(req.params.id); // throws
//     res.json(account);
//   });
//
// ...and findById() throws or its Promise rejects, that rejection becomes
// an "unhandled promise rejection" — Express's own error-handling
// middleware never sees it, so the request just hangs or the process logs
// a scary unhandled-rejection warning instead of returning a proper error
// response. Without this wrapper, every single controller in this app
// would need to write out:
//
//   try {
//     ...
//   } catch (error) {
//     next(error);
//   }
//
// ...by hand, every time. asyncHandler writes that pattern exactly once,
// here, so every controller we build later can skip it entirely.

// asyncHandler is what's called a HIGHER-ORDER FUNCTION: a function that
// takes another function as input (here, `fn` — the actual controller
// logic) and returns a brand new function. The new function is what
// Express actually calls when a request comes in; it just wraps a bit of
// extra behavior around whatever `fn` does.
function asyncHandler(fn) {
  // This is the function Express will actually register as the route
  // handler. It has the same (req, res, next) signature Express always
  // expects, so from Express's point of view, nothing about how this is
  // used looks unusual at all.
  return function wrappedHandler(req, res, next) {
    // Promise.resolve(...) is the key trick here. It handles TWO
    // situations with one line:
    //
    //   1. If fn(req, res, next) is already an async function, calling it
    //      returns a real Promise — Promise.resolve() just passes that
    //      Promise straight through unchanged.
    //   2. If someone accidentally wraps a NON-async (synchronous)
    //      function with asyncHandler, fn(req, res, next) returns a plain
    //      value, not a Promise. Promise.resolve() wraps that plain value
    //      in a Promise anyway, so .catch() below always works safely
    //      either way, instead of crashing with "fn(...).catch is not a
    //      function" if someone forgets the function was meant to be
    //      async.
    //
    // .catch(next) is doing something worth spelling out explicitly:
    // if the wrapped function's Promise rejects (because something threw
    // inside it, or an awaited call rejected), `.catch()` receives that
    // error as its argument and calls next(error). Passing `next`
    // directly as the catch handler is shorthand for
    // `.catch((error) => next(error))` — they behave identically here,
    // since next() takes exactly one argument (the error) in this case.
    //
    // Calling next(error) is what actually gets Express to route this
    // error to the centralized error-handling middleware (errorHandler.js,
    // built in an upcoming file) instead of the error disappearing
    // silently.
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default asyncHandler;