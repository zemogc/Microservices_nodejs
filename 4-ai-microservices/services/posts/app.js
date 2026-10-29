const Koa = require('koa');
const Router = require('@koa/router');
const { bodyParser } = require('@koa/bodyparser');
const seed = require('./db.json');

// Asks the ai service whether a post can be published. If the ai service
// is down or slow we publish anyway: moderation must never take posts down.
async function moderate(text, aiUrl) {
  if (!aiUrl) return null;
  try {
    const res = await fetch(`${aiUrl}/api/ai/moderate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(Number(process.env.MODERATION_TIMEOUT_MS) || 15000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function createApp(data = structuredClone(seed), { aiUrl = process.env.AI_URL } = {}) {
  const app = new Koa();
  const router = new Router();
  let nextId = Math.max(0, ...data.posts.map((p) => p.id)) + 1;

  // Log requests
  app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    if (process.env.NODE_ENV !== 'test') {
      console.log('[posts] %s %s - %s - %sms', ctx.method, ctx.url, ctx.status, Date.now() - start);
    }
  });
  app.use(bodyParser());

  router.get('/api/posts', (ctx) => {
    ctx.body = data.posts;
  });

  router.get('/api/posts/in-thread/:threadId', (ctx) => {
    const id = parseInt(ctx.params.threadId);
    ctx.body = data.posts.filter((post) => post.thread === id);
  });

  router.get('/api/posts/by-user/:userId', (ctx) => {
    const id = parseInt(ctx.params.userId);
    ctx.body = data.posts.filter((post) => post.user === id);
  });

  router.post('/api/posts', async (ctx) => {
    const { thread, user, text } = ctx.request.body || {};
    if (!Number.isInteger(thread)) ctx.throw(400, 'thread must be a thread id');
    if (!Number.isInteger(user)) ctx.throw(400, 'user must be a user id');
    if (typeof text !== 'string' || !text.trim()) ctx.throw(400, 'text is required');

    const verdict = await moderate(text, aiUrl);
    if (verdict && verdict.allowed === false) {
      ctx.status = 422;
      ctx.body = { error: 'Post rejected by moderation', moderation: verdict };
      return;
    }

    const post = {
      id: nextId++,
      thread,
      user,
      text: text.trim().slice(0, 2000),
      createdAt: new Date().toISOString(),
      moderation: verdict ? { mode: verdict.mode, reason: verdict.reason } : null,
    };
    data.posts.push(post);
    ctx.status = 201;
    ctx.body = post;
  });

  router.get('/health', (ctx) => {
    ctx.body = { service: 'posts', status: 'ok', uptime: process.uptime(), count: data.posts.length };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}

module.exports = { createApp };
