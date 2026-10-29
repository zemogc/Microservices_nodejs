const path = require('path');
const Koa = require('koa');
const Router = require('@koa/router');
const serve = require('koa-static');

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

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function proxy(ctx, target) {
  const hasBody = !['GET', 'HEAD'].includes(ctx.method);
  try {
    const res = await fetch(target + ctx.url, {
      method: ctx.method,
      headers: { 'content-type': ctx.get('content-type') || 'application/json' },
      body: hasBody ? await readBody(ctx.req) : undefined,
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
  const router = new Router();

  // Log requests
  app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    if (process.env.NODE_ENV !== 'test' && ctx.path.startsWith('/api')) {
      console.log('[gateway] %s %s - %s - %sms', ctx.method, ctx.url, ctx.status, Date.now() - start);
    }
  });

  router.get('/api/health', async (ctx) => {
    const checks = await Promise.all(Object.entries(services()).map(([name, url]) => probe(name, url)));
    ctx.body = {
      gateway: { status: 'up', uptime: process.uptime() },
      services: checks,
      healthy: checks.every((c) => c.status === 'up'),
    };
  });

  router.get('/health', (ctx) => {
    ctx.body = { service: 'gateway', status: 'ok', uptime: process.uptime() };
  });

  app.use(router.routes());
  app.use(async (ctx, next) => {
    const route = ROUTES.find(([prefix]) => ctx.path === prefix || ctx.path.startsWith(`${prefix}/`));
    if (!route) return next();
    await proxy(ctx, services()[route[1]]);
  });
  app.use(serve(path.join(__dirname, 'public')));
  return app;
}

module.exports = { createApp };
