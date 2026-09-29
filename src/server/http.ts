import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => { void handler(req, res, next).catch(next); };
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof z.ZodError) return error.issues.map((issue) => issue.message).join('; ');
  return 'The request could not be completed. Check configuration and try again.';
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T { return schema.parse(body); }
