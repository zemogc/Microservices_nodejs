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

// Everything at once, for questions about the whole forum
async function loadForum() {
  const { users, threads, posts } = urls();
  const [allThreads, allPosts, allUsers] = await Promise.all([
    getJson(`${threads}/api/threads`),
    getJson(`${posts}/api/posts`),
    getJson(`${users}/api/users`),
  ]);
  return { threads: allThreads ?? [], posts: allPosts ?? [], users: allUsers ?? [] };
}

// Summaries only change when a thread gets new posts, so the key includes the last post id
const MAX_CACHED = 200;
const summaryKey = ({ thread, posts }) => `${thread.id}:${posts.length}:${posts.at(-1)?.id ?? 0}`;

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
  const summaries = new Map();

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

    const key = summaryKey(thread);
    if (summaries.has(key)) {
      ctx.body = { ...summaries.get(key), cached: true, ms: 0 };
      return;
    }
    const result = await run('summarize', () => claude.summarize(thread), () => demo.summarize(thread));
    // Demo results are instant, and caching them would hide Claude once a key is configured
    if (result.mode === 'claude') {
      if (summaries.size >= MAX_CACHED) summaries.delete(summaries.keys().next().value);
      summaries.set(key, result);
    }
    ctx.body = { ...result, cached: false };
  });

  router.post('/api/ai/ask', async (ctx) => {
    const question = ctx.request.body?.question;
    if (typeof question !== 'string' || !question.trim()) ctx.throw(400, 'question is required');
    if (question.length > 500) ctx.throw(400, 'question is too long');
    const forum = await loadForum();

    const result = await run('ask', () => claude.ask(forum, question.trim()), () => demo.ask(forum, question.trim()));
    // Only keep sources that point to real threads, and attach their titles for the UI
    const sources = result.sources
      .map((s) => ({ ...s, title: forum.threads.find((t) => t.id === s.threadId)?.title }))
      .filter((s) => s.title);
    ctx.body = { ...result, sources };
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
