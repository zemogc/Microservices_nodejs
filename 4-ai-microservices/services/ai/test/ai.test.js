const test = require('node:test');
const assert = require('node:assert/strict');
const { listen } = require('../../../test-helpers');
const users = require('../../users/app');
const threads = require('../../threads/app');
const posts = require('../../posts/app');

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// Boots the real users/threads/posts services and points the ai service at them
async function platform(t) {
  process.env.USERS_URL = await listen(users.createApp(), t);
  process.env.THREADS_URL = await listen(threads.createApp(), t);
  process.env.POSTS_URL = await listen(posts.createApp(undefined, { aiUrl: null }), t);
  const { createApp } = require('../app');
  return listen(createApp(), t);
}

test('demo mode: summarizes a thread with data from the other services', async (t) => {
  delete process.env.ANTHROPIC_API_KEY;
  const url = await platform(t);

  const res = await post(`${url}/api/ai/summarize`, { threadId: 2 });
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.mode, 'demo');
  assert.match(r.summary, /Fiesta en el Dulce Reino/);
  assert.ok(['positivo', 'neutral', 'negativo', 'mixto'].includes(r.sentiment));
  assert.ok(r.topics.includes('eventos'));
});

test('demo mode: suggests a reply in the voice of the user', async (t) => {
  delete process.env.ANTHROPIC_API_KEY;
  const url = await platform(t);
  const r = await (await post(`${url}/api/ai/suggest-reply`, { threadId: 3, userId: 5 })).json();
  assert.match(r.reply, /BMO/);
});

test('demo mode: moderation blocks insults and allows friendly text', async (t) => {
  delete process.env.ANTHROPIC_API_KEY;
  const url = await platform(t);

  const bad = await (await post(`${url}/api/ai/moderate`, { text: 'Eres un idiota' })).json();
  assert.equal(bad.allowed, false);
  assert.deepEqual(bad.categories, ['insultos']);

  const good = await (await post(`${url}/api/ai/moderate`, { text: '¡Qué buena fiesta!' })).json();
  assert.equal(good.allowed, true);
});

test('answers 404 for unknown threads and 400 for bad input', async (t) => {
  const url = await platform(t);
  assert.equal((await post(`${url}/api/ai/summarize`, { threadId: 999 })).status, 404);
  assert.equal((await post(`${url}/api/ai/summarize`, {})).status, 400);
  assert.equal((await post(`${url}/api/ai/moderate`, { text: '' })).status, 400);
});

test('claude mode: sends a structured-output request and uses the parsed answer', async (t) => {
  let captured;
  // Minimal stand-in for the Messages API
  const fakeAnthropic = async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    captured = { path: req.url, body: JSON.parse(body) };
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: captured.body.model,
        content: [{ type: 'text', text: JSON.stringify({ allowed: false, reason: 'Acoso', categories: ['acoso'] }) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      })
    );
  };
  process.env.ANTHROPIC_BASE_URL = await listen(fakeAnthropic, t);
  process.env.ANTHROPIC_API_KEY = 'test-key';
  t.after(() => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
  });
  const url = await platform(t);

  const r = await (await post(`${url}/api/ai/moderate`, { text: 'algo feo' })).json();
  assert.equal(r.mode, 'claude');
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'Acoso');

  assert.equal(captured.path, '/v1/messages');
  assert.equal(captured.body.model, 'claude-opus-5-5');
  assert.equal(captured.body.output_config.effort, 'low');
  assert.equal(captured.body.output_config.format.type, 'json_schema');
  assert.match(captured.body.messages[0].content, /<foro>\nalgo feo\n<\/foro>/);
});

test('claude mode: falls back to the demo engine when the API fails', async (t) => {
  process.env.ANTHROPIC_BASE_URL = await listen((req, res) => {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'boom' } }));
  }, t);
  process.env.ANTHROPIC_API_KEY = 'test-key';
  t.after(() => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
  });
  const url = await platform(t);

  const r = await (await post(`${url}/api/ai/moderate`, { text: 'Hola a todos' })).json();
  assert.equal(r.mode, 'demo');
  assert.equal(r.allowed, true);
  assert.ok(r.fallbackReason);
});

// Fake Messages API that always answers with `payload` as the structured output
async function fakeClaude(t, payload) {
  const calls = [];
  process.env.ANTHROPIC_BASE_URL = await listen(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push(JSON.parse(body));
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        id: `msg_${calls.length}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      })
    );
  }, t);
  process.env.ANTHROPIC_API_KEY = 'test-key';
  t.after(() => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
  });
  return calls;
}

test('demo mode: answers questions about the forum citing the source thread', async (t) => {
  delete process.env.ANTHROPIC_API_KEY;
  const url = await platform(t);

  const r = await (await post(`${url}/api/ai/ask`, { question: '¿Alguien vende guitarras?' })).json();
  assert.equal(r.mode, 'demo');
  assert.equal(r.sources[0].threadId, 3);
  assert.equal(r.sources[0].title, 'Busco una guitarra nueva');
  assert.match(r.answer, /guitarra/);

  const none = await (await post(`${url}/api/ai/ask`, { question: '¿Dónde compro naves espaciales?' })).json();
  assert.deepEqual(none.sources, []);
  assert.equal((await post(`${url}/api/ai/ask`, { question: ' ' })).status, 400);
});

test('claude mode: drops sources that point to threads that do not exist', async (t) => {
  await fakeClaude(t, {
    answer: 'Simon tiene una guitarra vieja.',
    sources: [
      { threadId: 3, reason: 'Simon la ofrece' },
      { threadId: 999, reason: 'inventado' },
    ],
  });
  const url = await platform(t);

  const r = await (await post(`${url}/api/ai/ask`, { question: '¿Quién tiene guitarra?' })).json();
  assert.equal(r.mode, 'claude');
  assert.deepEqual(r.sources.map((s) => s.threadId), [3]);
});

test('claude mode: caches summaries until the thread gets a new post', async (t) => {
  const calls = await fakeClaude(t, { summary: 'Resumen', sentiment: 'neutral', topics: ['x'], nextSteps: [] });
  const url = await platform(t);

  const first = await (await post(`${url}/api/ai/summarize`, { threadId: 1 })).json();
  const second = await (await post(`${url}/api/ai/summarize`, { threadId: 1 })).json();
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls.length, 1);

  await post(`${process.env.POSTS_URL}/api/posts`, { thread: 1, user: 2, text: 'Novedades' });
  const third = await (await post(`${url}/api/ai/summarize`, { threadId: 1 })).json();
  assert.equal(third.cached, false);
  assert.equal(calls.length, 2);
});
