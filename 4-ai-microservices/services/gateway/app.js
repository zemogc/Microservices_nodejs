const path = require('path');
const Koa = require('koa');
const Router = require('@koa/router');
const serve = require('koa-static');
const { observability } = require('./observability');
const { createEventHub } = require('./events');

const services = () => ({
  users: process.env.USERS_URL || 'http://localhost:3001',
  threads: process.env.THREADS_URL || 'http://localhost:3002',
  posts: process.env.POSTS_URL || 'http://localhost:3003',
  ai: process.env.AI_URL || 'http://localhost:3004',
});

// Same role the ALB rules play in part 3: route by path prefix
const ROUTES = [
  ['/api/users', 'users'],
  ['/api/threads', 'threads'],
  ['/api/posts', 'posts'],
  ['/api/ai', 'ai'],
];

// Successful creations that are pushed to browsers over /api/events
const LIVE_EVENTS = { '/api/posts': 'post', '/api/threads': 'thread' };

const MAX_BODY_BYTES = 100 * 1024;

async function readBody(ctx) {
  const chunks = [];
  let size = 0;
  for await (const chunk of ctx.req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) ctx.throw(413, 'Request body too large');
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

// AI calls cost money, so each client gets a fixed number per minute
function rateLimit({ limit, windowMs = 60_000 }) {
  const hits = new Map();
  return async (ctx, next) => {
    const now = Date.now();
    const entry = hits.get(ctx.ip);
    const bucket = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + windowMs };
    bucket.count++;
    hits.set(ctx.ip, bucket);
    // Forget expired clients so the map does not grow forever
    if (hits.size > 10_000) {
      for (const [ip, b] of hits) if (b.resetAt <= now) hits.delete(ip);
    }

    ctx.set('RateLimit-Limit', String(limit));
    ctx.set('RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    if (bucket.count > limit) {
      ctx.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      ctx.status = 429;
      ctx.body = { error: 'Demasiadas peticiones a la IA, espera un momento' };
      return;
    }
    await next();
  };
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

async function proxy(ctx, target, headers) {
  const hasBody = !['GET', 'HEAD'].includes(ctx.method);
  const body = hasBody ? await readBody(ctx) : undefined;
  try {
    const res = await fetch(target + ctx.url, {
      method: ctx.method,
      headers: { 'content-type': ctx.get('content-type') || 'application/json', ...headers },
      body,
      signal: AbortSignal.timeout(60000),
    });
    ctx.status = res.status;
    ctx.type = res.headers.get('content-type') || 'application/json';
    ctx.body = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    ctx.status = 502;
    ctx.body = { error: 'Service unavailable', detail: err.message };
  }
}

async function probe(name, url) {
  const started = Date.now();
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
    const { service, status, ...details } = await res.json();
    return { ...details, name, status: res.ok && status === 'ok' ? 'up' : 'down', latencyMs: Date.now() - started };
  } catch {
    return { name, status: 'down', latencyMs: Date.now() - started };
  }
}

function createApp() {
  const app = new Koa();
  // Behind an ALB the client address comes in X-Forwarded-For
  app.proxy = process.env.TRUST_PROXY === 'true';
  const router = new Router();
  const events = createEventHub();
  // A browser closing its /api/events stream is routine, not an error worth logging
  app.on('error', (err) => {
    if (err.code === 'ERR_STREAM_PREMATURE_CLOSE' || err.status < 500) return;
    console.error(JSON.stringify({ ts: new Date().toISOString(), service: 'gateway', error: err.message }));
  });

  const obs = observability('gateway', { quiet: (path) => !path.startsWith('/api') || path === '/api/health' });
  app.use(obs.middleware);
  app.use(async (ctx, next) => {
    ctx.set(SECURITY_HEADERS);
    await next();
  });

  // Every new post also triggers an AI moderation call, so it shares the AI budget
  const aiLimit = rateLimit({ limit: Number(process.env.AI_RATE_LIMIT) || 20 });
  const usesAi = (ctx) => ctx.method === 'POST' && (ctx.path.startsWith('/api/ai/') || ctx.path === '/api/posts');
  app.use((ctx, next) => (usesAi(ctx) ? aiLimit(ctx, next) : next()));

  router.get('/api/health', async (ctx) => {
    const checks = await Promise.all(Object.entries(services()).map(([name, url]) => probe(name, url)));
    ctx.body = {
      gateway: { status: 'up', uptime: process.uptime(), ...obs.stats, liveClients: events.size() },
      services: checks,
      healthy: checks.every((c) => c.status === 'up'),
    };
  });

  router.get('/health', (ctx) => {
    ctx.body = { service: 'gateway', status: 'ok', uptime: process.uptime(), ...obs.stats };
  });

  router.get('/api/events', (ctx) => events.subscribe(ctx));

  app.use(router.routes());
  app.use(async (ctx, next) => {
    const route = ROUTES.find(([prefix]) => ctx.path === prefix || ctx.path.startsWith(`${prefix}/`));
    if (!route) return next();
    await proxy(ctx, services()[route[1]], obs.forward(ctx));

    // Tell every open browser about what was just created
    const created = LIVE_EVENTS[ctx.path];
    if (ctx.method === 'POST' && ctx.status === 201 && created) {
      try {
        events.publish(created, { requestId: ctx.state.requestId, item: JSON.parse(ctx.body.toString()) });
      } catch {
        // A non-JSON answer is not worth breaking the request over
      }
    }
  });
  app.use(serve(path.join(__dirname, 'public')));
  return app;
}

module.exports = { createApp };
