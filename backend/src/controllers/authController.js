// src/controllers/authController.js
//
// WHY CONTROLLERS STAY THIN: a controller's ONLY job is translating
// between HTTP and the service layer — read what the client sent
// (req.body), call the one service function that knows what to do with
// it, and shape whatever comes back into an HTTP response (status code +
// JSON body). Everything this file does could be summarized as
// "unwrap the request, call a service, wrap the response." There is
// deliberately no decision-making here about WHAT counts as a valid
// registration, WHAT happens on a 5th failed login, or WHAT a token
// looks like — all of that already happened in authService.js.
//
// WHY SERVICES CONTAIN THE BUSINESS LOGIC, NOT CONTROLLERS: business
// rules (password hashing, account lockout, anti-enumeration error
// messages, token generation) need to behave IDENTICALLY no matter how
// they're triggered — from this HTTP controller today, potentially from
// a CLI admin tool or an internal service call later. If that logic were
// written inside this controller, it would be tied to Express's
// req/res/next objects and could only ever be reached over HTTP. Keeping
// it in authService.js — a plain set of functions with no knowledge of
// HTTP at all — means the exact same rules apply everywhere, and the
// logic can be unit-tested by calling authService functions directly,
// without needing to fake an HTTP request at all.
//
// WHY CONTROLLERS NEVER ACCESS REPOSITORIES DIRECTLY: skipping the
// service layer and calling userRepository functions from here would let
// a controller insert a user into the database WITHOUT hashing the
// password first, or WITHOUT the duplicate-email check, or WITHOUT
// tracking failed logins — because those rules live in authService, not
// in the repository itself. The repository layer only knows SQL; it
// trusts whoever calls it to have already applied the business rules.
// Going through authService every time is what GUARANTEES those rules
// can never accidentally be bypassed.

import { register, login } from '../services/authService.js';
import asyncHandler from '../utils/asyncHandler.js';

// ----------------------------------------------------------------------------
// POST /api/v1/auth/register (route wiring happens in a later file —
// this controller doesn't know or care what path it's mounted at)
// ----------------------------------------------------------------------------
export const registerController = asyncHandler(async (req, res) => {
  // req.body is trusted here to already contain email/password in a
  // reasonable shape — validating and sanitizing the SHAPE of incoming
  // data (e.g. "is this a well-formed email string," "is the password
  // long enough") is the job of validator middleware that will run
  // BEFORE this controller, in a future file. This controller's job is
  // simpler: take what's already been validated, pass it straight
  // through to the service that knows what to actually do with it.
  const { email, password } = req.body;

  // asyncHandler (imported above) is what allows us to simply await this
  // and let a thrown AppError propagate naturally — no try/catch needed
  // here. If register() throws (e.g. AppError('email already exists',
  // 409)), asyncHandler catches that rejection and forwards it to
  // next(error) automatically, which routes it straight to our
  // centralized errorHandler.js. This controller function only ever
  // needs to describe the SUCCESS path — the failure path is handled
  // once, centrally, for every controller in the whole app.
  const newUser = await register({ email, password });

  // 201 Created is the correct status for "a new resource was created,"
  // which is exactly what a successful registration is — as opposed to
  // 200 OK, which would be correct for e.g. a login (nothing new is
  // created, an existing user is simply verified).
  res.status(201).json({
    success: true,
    message: 'Registration successful',
    data: newUser,
  });
});

// ----------------------------------------------------------------------------
// POST /api/v1/auth/login
// ----------------------------------------------------------------------------
export const loginController = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // login() either returns { user, accessToken, refreshToken } or throws
  // an AppError (401 for bad credentials, 423 for a locked account, 403
  // for a suspended one) — this controller doesn't need to know which
  // specific failure is possible, or check anything itself; it simply
  // awaits the call and lets asyncHandler forward whatever happens.
  const result = await login({ email, password });

  // 200 OK — logging in doesn't create a new resource, it verifies
  // access to an existing one.
  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
  });
});