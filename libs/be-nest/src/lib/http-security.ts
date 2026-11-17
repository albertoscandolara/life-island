import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import {
  numberEnv,
  refuseDevSecretsInProduction,
} from '@life-island/be-common';
import type { IncomingMessage, ServerResponse } from 'node:http';

/*
 * The HTTP hardening every service applies at startup (docs/security.md):
 * response headers, a cross-site request check for writes, and a per-client
 * rate limit. The gateway adds the browser-facing headers (HSTS, CSP) and
 * sign-in; this layer still holds if a service port is reached directly.
 *
 * CORS stays off on purpose: no service sends Access-Control-Allow-Origin, so
 * a page on another site cannot read any answer. The front end reaches the
 * services on its own origin (the gateway, or the dev server's proxy).
 */

export interface HttpSecurityOptions {
  /** e.g. `svc-money`, for errors and logs. */
  service: string;
  /** The service's resolved config: in production a dev secret in it stops the service. */
  config?: unknown;
  /** Requests per minute from one client before 429; RATE_LIMIT_PER_MINUTE, default 600. */
  rateLimitPerMinute?: number;
  env?: NodeJS.ProcessEnv;
}

type Next = (error?: unknown) => void;
type Middleware = (
  req: IncomingMessage & { ip?: string },
  res: ServerResponse,
  next: Next,
) => void;

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Paths a health check calls; never limited. */
const HEALTH_PATHS = new Set(['/health', '/healthz']);

export function applyHttpSecurity(
  app: INestApplication,
  options: HttpSecurityOptions,
): void {
  const env = options.env ?? process.env;
  refuseDevSecretsInProduction(options.service, options.config, env);

  const express = app.getHttpAdapter().getInstance() as {
    disable?: (setting: string) => void;
    set?: (setting: string, value: unknown) => void;
  };
  express.disable?.('x-powered-by');
  // Behind the gateway the client address is in X-Forwarded-For; trust it only
  // from private networks (the gateway's container), never from the internet.
  express.set?.('trust proxy', 'loopback, linklocal, uniquelocal');

  app.use(securityHeaders());
  app.use(crossSiteWriteGuard());
  app.use(
    rateLimit(
      options.rateLimitPerMinute ??
        numberEnv('RATE_LIMIT_PER_MINUTE', 600, env),
      new Logger(options.service),
    ),
  );
}

/** Headers that keep answers out of caches, frames on other sites and type sniffing. */
export function securityHeaders(): Middleware {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    // Personal data: never kept by a browser or proxy cache unless a route says so.
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

/**
 * Refuses a write that a browser sent from another site (CSRF). Browsers tell
 * where a request comes from with Sec-Fetch-Site; requests without it (a
 * service calling another, curl) are judged by sign-in, not here.
 */
export function crossSiteWriteGuard(): Middleware {
  return (req, res, next) => {
    if (!UNSAFE_METHODS.has(req.method ?? '')) return next();
    const site = header(req, 'sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          statusCode: 403,
          message: 'Requests from other sites are not allowed.',
        }),
      );
      return;
    }
    next();
  };
}

/**
 * A fixed one-minute window per client address. In memory, so per instance:
 * enough for one machine; the gateway is the place for a shared limit.
 */
export function rateLimit(
  perMinute: number,
  logger?: Logger,
  now: () => number = Date.now,
): Middleware {
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = now();
  return (req, res, next) => {
    if (perMinute <= 0 || HEALTH_PATHS.has(pathOf(req))) return next();
    const time = now();
    if (time - lastSweep > 60_000) {
      for (const [key, window] of windows)
        if (time - window.start >= 60_000) windows.delete(key);
      lastSweep = time;
    }
    const client = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    let window = windows.get(client);
    if (!window || time - window.start >= 60_000) {
      window = { start: time, count: 0 };
      windows.set(client, window);
    }
    window.count++;
    if (window.count > perMinute) {
      const retryAfter = Math.ceil((window.start + 60_000 - time) / 1000);
      if (window.count === perMinute + 1)
        logger?.warn(`Rate limit reached for ${client}`);
      res.statusCode = 429;
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          statusCode: 429,
          message: `Too many requests. Try again in ${retryAfter} seconds.`,
        }),
      );
      return;
    }
    next();
  };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase();
}

function pathOf(req: IncomingMessage): string {
  return (req.url ?? '/').split('?')[0] ?? '/';
}
