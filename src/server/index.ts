import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sessionMiddleware, login, logout, assertTrustedOrigin } from './auth/passcode.js';
import { apiRouter } from './routes/api.js';
import { PORT, assertServerConfig } from './config.js';
import { safeErrorMessage } from './http.js';

const app = express();
const server = createServer(app);
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use((req: Request, _res: Response, next: NextFunction) => {
  const cookies: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    try { cookies[name] = decodeURIComponent(part.slice(separator + 1).trim()); } catch { /* Ignore malformed cookies. */ }
  }
  req.cookies = cookies;
  next();
});
app.use(sessionMiddleware);
app.post('/api/auth/login', (req, res, next) => { void login(req, res).catch(next); });
app.post('/api/auth/logout', (req, res, next) => { try { logout(req, res); } catch (error) { next(error); } });
app.use('/api', (req, _res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.path !== '/auth/login' && req.path !== '/auth/logout') {
    try { assertTrustedOrigin(req); } catch (error) { next(error); return; }
  }
  next();
});
app.use('/api', apiRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number' ? error.status : 500;
  if (status >= 500) console.error('[api-error]', safeErrorMessage(error));
  res.status(status).json({ error: safeErrorMessage(error) });
});

const clientPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/client');
app.use(express.static(clientPath));
app.get('/{*splat}', (_req, res) => res.sendFile(path.join(clientPath, 'index.html'), (error) => { if (error) res.status(404).send('Client build not found. Run pnpm build first.'); }));

try { assertServerConfig(); } catch (error) {
  const reason = error instanceof Error ? error.message : 'Server configuration is invalid.';
  console.warn('[startup-config]', reason);
}
server.listen(PORT, '0.0.0.0', () => console.info(`Reception console listening on ${PORT}`));
