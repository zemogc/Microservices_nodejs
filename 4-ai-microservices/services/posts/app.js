const Koa = require('koa');
const Router = require('@koa/router');
const { bodyParser } = require('@koa/bodyparser');
const seed = require('./db.json');
const { observability } = require('./observability');

// Asks the ai service whether a post can be published. If the ai service
// is down or slow we publish anyway: moderation must never take posts down.
async function moderate(text, aiUrl, headers) {
  if (!aiUrl) return null;
  try {
    const res = await fetch(`${aiUrl}/api/ai/moderate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
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

  const obs = observability('posts');
  app.use(obs.middleware);
  app.use(bodyParser({ jsonLimit: '100kb' }));

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

    const verdict = await moderate(text, aiUrl, obs.forward(ctx));
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
    ctx.body = { service: 'posts', status: 'ok', uptime: process.uptime(), ...obs.stats, count: data.posts.length };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}

module.exports = { createApp };
