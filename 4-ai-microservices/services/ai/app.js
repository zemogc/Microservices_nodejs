const Koa = require('koa');
const Router = require('@koa/router');
const { bodyParser } = require('@koa/bodyparser');
const claude = require('./claude');
const demo = require('./demo');

const urls = () => ({
  users: process.env.USERS_URL || 'http://localhost:3001',
  threads: process.env.THREADS_URL || 'http://localhost:3002',
  posts: process.env.POSTS_URL || 'http://localhost:3003',
});

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

// Gathers everything the models need about a thread from the other services
async function loadThread(threadId) {
  const { users, threads, posts } = urls();
  const [thread, threadPosts, allUsers] = await Promise.all([
    getJson(`${threads}/api/threads/${threadId}`),
    getJson(`${posts}/api/posts/in-thread/${threadId}`),
    getJson(`${users}/api/users`),
  ]);
  return thread && { thread, posts: threadPosts ?? [], users: allUsers ?? [] };
}

// Runs a task on Claude when configured, otherwise (or on failure) on the demo engine.
async function run(name, viaClaude, viaDemo) {
  const started = Date.now();
  let fallbackReason = 'ANTHROPIC_API_KEY no está configurada';
  if (claude.isEnabled()) {
    try {
      const result = await viaClaude();
      return { ...result, mode: 'claude', model: claude.MODEL, ms: Date.now() - started };
    } catch (err) {
      console.error(`[ai] ${name} failed on Claude, using demo engine:`, err.message);
      fallbackReason = err.message;
    }
  }
  return { ...viaDemo(), mode: 'demo', model: 'demo-local', fallbackReason, ms: Date.now() - started };
}

function createApp() {
  const app = new Koa();
  const router = new Router();

  // Log requests
  app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    if (process.env.NODE_ENV !== 'test') {
      console.log('[ai] %s %s - %s - %sms', ctx.method, ctx.url, ctx.status, Date.now() - start);
    }
  });
  app.use(bodyParser());

  router.get('/api/ai/status', (ctx) => {
    ctx.body = claude.isEnabled()
      ? { mode: 'claude', model: claude.MODEL }
      : { mode: 'demo', model: 'demo-local', hint: 'Define ANTHROPIC_API_KEY para usar Claude' };
  });

  router.post('/api/ai/summarize', async (ctx) => {
    const threadId = parseInt(ctx.request.body?.threadId);
    if (!Number.isInteger(threadId)) ctx.throw(400, 'threadId is required');
    const thread = await loadThread(threadId);
    if (!thread) ctx.throw(404, 'Thread not found');

    ctx.body = await run('summarize', () => claude.summarize(thread), () => demo.summarize(thread));
  });

  router.post('/api/ai/suggest-reply', async (ctx) => {
    const threadId = parseInt(ctx.request.body?.threadId);
    const userId = parseInt(ctx.request.body?.userId);
    if (!Number.isInteger(threadId) || !Number.isInteger(userId)) ctx.throw(400, 'threadId and userId are required');
    const thread = await loadThread(threadId);
    if (!thread) ctx.throw(404, 'Thread not found');
    const author = thread.users.find((u) => u.id === userId);
    if (!author) ctx.throw(404, 'User not found');

    ctx.body = await run(
      'suggest-reply',
      () => claude.suggestReply(thread, author),
      () => demo.suggestReply(thread, author)
    );
  });

  router.post('/api/ai/moderate', async (ctx) => {
    const text = ctx.request.body?.text;
    if (typeof text !== 'string' || !text.trim()) ctx.throw(400, 'text is required');

    ctx.body = await run('moderate', () => claude.moderate(text), () => demo.moderate(text));
  });

  router.get('/health', (ctx) => {
    ctx.body = { service: 'ai', status: 'ok', uptime: process.uptime(), mode: claude.isEnabled() ? 'claude' : 'demo' };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}

module.exports = { createApp };
