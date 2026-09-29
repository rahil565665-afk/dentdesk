import { hkdfSync, randomBytes } from 'node:crypto';
import type { CookieOptions } from 'express';

export const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);
export const SESSION_COOKIE = 'dentdesk_admin_session';

let developmentSessionSecret: Buffer | undefined;
function sessionSecretBytes(): Buffer {
  const configured = process.env.DASHBOARD_SESSION_SECRET?.trim();
  if (configured) {
    if (/^[0-9a-f]{64}$/i.test(configured)) return Buffer.from(configured, 'hex');
    if (Buffer.byteLength(configured) < 32) throw new Error('DASHBOARD_SESSION_SECRET must be 32 bytes or 64 hexadecimal characters.');
    return Buffer.from(configured, 'utf8');
  }
  if (process.env.NODE_ENV === 'production') throw new Error('DASHBOARD_SESSION_SECRET must be configured in hosted environments.');
  developmentSessionSecret ??= randomBytes(32);
  return developmentSessionSecret;
}

export function sessionSigningKey(): Uint8Array {
  return sessionSecretBytes();
}

export function voiceTokenSigningKeyHex(tenantId: string): string {
  return Buffer.from(hkdfSync('sha256', sessionSecretBytes(), Buffer.from(`dentdesk-voice:${tenantId}`, 'utf8'), Buffer.from('dentdesk-voice-session-v1'), 32)).toString('hex');
}

export function requestIsSecure(origin?: string | null): boolean {
  return Boolean(origin?.startsWith('https://') || process.env.APP_PUBLIC_URL?.startsWith('https://') || process.env.RENDER_EXTERNAL_URL?.startsWith('https://'));
}

export function cookieOptions(name = SESSION_COOKIE, secure = requestIsSecure()): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: '/',
    maxAge: name === SESSION_COOKIE ? 8 * 60 * 60 * 1000 : 5 * 60 * 1000,
  };
}

export function assertServerConfig(): void {
  const missing = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'DASHBOARD_ADMIN_PASSCODE']
    .filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing server configuration: ${missing.join(', ')}`);
  const passcode = process.env.DASHBOARD_ADMIN_PASSCODE ?? '';
  if (passcode.length < 8 || passcode.length > 128) throw new Error('DASHBOARD_ADMIN_PASSCODE must be between 8 and 128 characters.');
  // Validate the stable signing key in production; development receives one ephemeral process key.
  sessionSecretBytes();
}
