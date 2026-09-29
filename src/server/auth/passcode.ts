import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { cookieOptions, sessionSigningKey, SESSION_COOKIE } from '../config.js';
import { HttpError } from '../http.js';
import type { AppUser } from '../types.js';

const ADMIN_USER: AppUser = {
  id: '00000000-0000-4000-8000-000000000001',
  manus_open_id: 'passcode-admin',
  email: 'admin@dentdesk.local',
  display_name: 'Workspace administrator',
  is_platform_admin: true,
  is_active: true,
};

interface LoginAttempt { count: number; resetAt: number; }
const attempts = new Map<string, LoginAttempt>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

function configuredOrigin(): string | null {
  const raw = process.env.APP_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (!raw) return null;
  try { return new URL(raw).origin; } catch { throw new HttpError(503, 'The dashboard public origin is not configured correctly.'); }
}

export function assertTrustedOrigin(req: Request): void {
  const raw = req.get('origin');
  if (!raw) throw new HttpError(403, 'A trusted browser origin is required.');
  let origin: URL;
  try { origin = new URL(raw); } catch { throw new HttpError(403, 'The browser origin is invalid.'); }
  const configured = configuredOrigin();
  if (configured) {
    if (origin.origin !== configured) throw new HttpError(403, 'The request origin is not allowed.');
    return;
  }
  if ((origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)) ||
      (origin.protocol === 'https:' && (origin.hostname.endsWith('.manus.computer') || origin.hostname.endsWith('.manus.space')))) return;
  throw new HttpError(403, 'Set APP_PUBLIC_URL to the dashboard HTTPS origin before using this action.');
}

function secureRequest(req: Request): boolean {
  return Boolean(req.get('origin')?.startsWith('https://') || process.env.APP_PUBLIC_URL?.startsWith('https://') || process.env.RENDER_EXTERNAL_URL?.startsWith('https://'));
}

function passcodesMatch(candidate: string, expected: string): boolean {
  const left = Buffer.from(candidate, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function rateLimitKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function checkLoginRate(req: Request): void {
  const key = rateLimitKey(req);
  const now = Date.now();
  for (const [oldKey, state] of attempts) if (state.resetAt <= now) attempts.delete(oldKey);
  const state = attempts.get(key);
  if (state && state.resetAt > now && state.count >= MAX_ATTEMPTS) throw new HttpError(429, 'Too many login attempts. Wait a while, then try again.');
}

function recordFailedLogin(req: Request): void {
  const now = Date.now();
  const key = rateLimitKey(req);
  const previous = attempts.get(key);
  if (!previous || previous.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else previous.count += 1;
}

export async function login(req: Request, res: Response): Promise<void> {
  assertTrustedOrigin(req);
  checkLoginRate(req);
  const expected = process.env.DASHBOARD_ADMIN_PASSCODE;
  if (!expected || expected.length < 8) throw new HttpError(503, 'Dashboard passcode authentication is not configured.');
  const candidate = typeof req.body?.passcode === 'string' ? req.body.passcode.slice(0, 128) : '';
  if (!passcodesMatch(candidate, expected)) {
    recordFailedLogin(req);
    throw new HttpError(401, 'The passcode was not accepted.');
  }
  attempts.delete(rateLimitKey(req));
  const token = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('dashboard-admin')
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(sessionSigningKey());
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_COOKIE, secureRequest(req)));
  res.json({ ok: true });
}

export function logout(req: Request, res: Response): void {
  assertTrustedOrigin(req);
  res.clearCookie(SESSION_COOKIE, cookieOptions(SESSION_COOKIE, secureRequest(req)));
  res.json({ ok: true });
}

export async function userFromSessionToken(token: string): Promise<AppUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSigningKey(), { algorithms: ['HS256'] });
    if (payload.sub !== 'dashboard-admin' || payload.role !== 'admin') return null;
    return ADMIN_USER;
  } catch { return null; }
}

export function sessionMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE] ?? '';
  void userFromSessionToken(token).then((user) => {
    req.user = user;
    next();
  }).catch(() => {
    req.user = null;
    next();
  });
}
