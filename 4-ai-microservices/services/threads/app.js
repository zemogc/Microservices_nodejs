const Koa = require('koa');
const Router = require('@koa/router');
const { bodyParser } = require('@koa/bodyparser');
const seed = require('./db.json');

function createApp(data = structuredClone(seed)) {
  const app = new Koa();
  const router = new Router();
  let nextId = Math.max(0, ...data.threads.map((t) => t.id)) + 1;

  // Log requests
  app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    if (process.env.NODE_ENV !== 'test') {
      console.log('[threads] %s %s - %s - %sms', ctx.method, ctx.url, ctx.status, Date.now() - start);
    }
  });
  app.use(bodyParser());

  router.get('/api/threads', (ctx) => {
    ctx.body = [...data.threads].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  router.get('/api/threads/:threadId', (ctx) => {
    const id = parseInt(ctx.params.threadId);
    const thread = data.threads.find((t) => t.id === id);
    if (!thread) ctx.throw(404, 'Thread not found');
    ctx.body = thread;
  });

  router.post('/api/threads', (ctx) => {
    const { title, createdBy, tag = 'general' } = ctx.request.body || {};
    if (typeof title !== 'string' || !title.trim()) ctx.throw(400, 'title is required');
    if (!Number.isInteger(createdBy)) ctx.throw(400, 'createdBy must be a user id');

    const thread = {
      id: nextId++,
      title: title.trim().slice(0, 120),
      createdBy,
      tag: String(tag).slice(0, 24),
      createdAt: new Date().toISOString(),
    };
    data.threads.push(thread);
    ctx.status = 201;
    ctx.body = thread;
  });

  router.get('/health', (ctx) => {
    ctx.body = { service: 'threads', status: 'ok', uptime: process.uptime(), count: data.threads.length };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}

module.exports = { createApp };
