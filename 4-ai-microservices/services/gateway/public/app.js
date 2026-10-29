const state = { users: [], threads: [], posts: [], currentThread: null };
// Ids of the writes this tab made, so it can ignore its own live events
const myRequests = new Set();
const newRequestId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const userById = (id) => state.users.find((u) => u.id === id) ?? { name: `Usuario ${id}`, username: '?', color: '#64748b' };
const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const fmtDate = (iso) => new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Every API call goes through the gateway and is shown in the request log
async function api(path, options = {}) {
  const started = performance.now();
  const requestId = newRequestId();
  if (options.method === 'POST' && ['/api/posts', '/api/threads'].includes(path)) myRequests.add(requestId);
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-request-id': requestId },
    body: options.body && JSON.stringify(options.body),
  });
  logRequest(options.method || 'GET', path, res.status, Math.round(performance.now() - started));
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    myRequests.delete(requestId);
    const err = new Error(data?.error || data?.message || `Error ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

function logRequest(method, path, status, ms) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="m">${method}</span><span class="p" title="${esc(path)}">${esc(path)}</span>
    <span class="s ${status < 400 ? 'ok' : 'err'}">${status} · ${ms}ms</span>`;
  const log = $('#request-log');
  log.prepend(li);
  while (log.children.length > 9) log.lastChild.remove();
}

function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.className = 'toast'), 4000);
}

const currentUserId = () => parseInt($('#current-user').value);

/* ---------- Rendering ---------- */

function renderUsers() {
  $('#current-user').innerHTML = state.users
    .map((u) => `<option value="${u.id}">${esc(u.name)} (@${esc(u.username)})</option>`)
    .join('');
}

function renderThreadList() {
  $('#thread-list').innerHTML = state.threads
    .map((t) => {
      const count = state.posts.filter((p) => p.thread === t.id).length;
      const active = state.currentThread?.id === t.id ? 'active' : '';
      return `<li><a href="#/thread/${t.id}" class="${active}">
        <div class="title">${esc(t.title)}</div>
        <div class="meta"><span class="tag">${esc(t.tag)}</span><span>💬 ${count}</span><span>@${esc(userById(t.createdBy).username)}</span></div>
      </a></li>`;
    })
    .join('');
}

function postHtml(p) {
  const u = userById(p.user);
  const mod = p.moderation ? `<div class="mod">✔ Revisado por IA (${esc(p.moderation.mode)})</div>` : '';
  return `<article class="post">
    <div class="avatar" style="background:${esc(u.color)}">${esc(initials(u.name))}</div>
    <div class="bubble">
      <div class="who">${esc(u.name)}<span>@${esc(u.username)} · ${fmtDate(p.createdAt)}</span></div>
      <p>${esc(p.text)}</p>${mod}
    </div>
  </article>`;
}

function threadMeta(t) {
  const count = state.posts.filter((p) => p.thread === t.id).length;
  return `Creado por ${userById(t.createdBy).name} · ${fmtDate(t.createdAt)} · ${count} mensajes`;
}

function renderThread() {
  const t = state.currentThread;
  if (!t) return;
  const posts = state.posts.filter((p) => p.thread === t.id);

  $('#thread-view').innerHTML = `
    <div class="thread-header">
      <span class="tag">${esc(t.tag)}</span>
      <h2>${esc(t.title)}</h2>
      <div class="meta">${esc(threadMeta(t))}</div>
    </div>

    <div class="ai-card">
      <div class="row">
        <div>
          <h3>✨ Asistente IA</h3>
          <p class="hint">Claude lee el hilo completo (vía los microservicios) y te da el contexto en segundos.</p>
        </div>
        <button class="btn btn-ai" id="summarize-btn">Resumir hilo</button>
      </div>
      <div id="ai-result"></div>
    </div>

    <div class="posts">${posts.map(postHtml).join('')}</div>

    <form class="composer" id="composer">
      <textarea id="post-text" rows="3" placeholder="Escribe una respuesta… (la IA la modera antes de publicarla)"></textarea>
      <div class="actions">
        <button type="button" class="btn btn-ghost" id="suggest-btn">💡 Sugerir respuesta</button>
        <button type="submit" class="btn" id="publish-btn">Publicar</button>
      </div>
    </form>`;

  $('#summarize-btn').onclick = summarize;
  $('#suggest-btn').onclick = suggestReply;
  $('#composer').onsubmit = publish;
}

function aiMeta(r) {
  const how = r.mode === 'claude' ? `Claude · ${r.model}` : 'modo demo local';
  const when = r.cached ? 'desde caché (sin llamar a la IA)' : `en ${r.ms} ms`;
  return `<div class="ai-meta">Generado con ${esc(how)} ${when}</div>`;
}

/* ---------- Actions ---------- */

async function withLoading(btn, fn) {
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    await fn();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

function summarize() {
  return withLoading($('#summarize-btn'), async () => {
    const r = await api('/api/ai/summarize', { method: 'POST', body: { threadId: state.currentThread.id } });
    $('#ai-result').innerHTML = `<div class="ai-result">
      <p>${esc(r.summary)}</p>
      <div class="chips">
        <span class="chip ${esc(r.sentiment)}">Sentimiento: ${esc(r.sentiment)}</span>
        ${r.topics.map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}
      </div>
      ${r.nextSteps.length ? `<ul>${r.nextSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      ${aiMeta(r)}
    </div>`;
  });
}

function suggestReply() {
  return withLoading($('#suggest-btn'), async () => {
    const r = await api('/api/ai/suggest-reply', {
      method: 'POST',
      body: { threadId: state.currentThread.id, userId: currentUserId() },
    });
    $('#post-text').value = r.reply;
    $('#post-text').focus();
    toast(`Sugerencia lista (${r.mode === 'claude' ? 'Claude' : 'modo demo'}) — edítala o publícala`);
  });
}

function publish(event) {
  event.preventDefault();
  const text = $('#post-text').value.trim();
  if (!text) return toast('Escribe algo primero', 'error');

  return withLoading($('#publish-btn'), async () => {
    try {
      const post = await api('/api/posts', {
        method: 'POST',
        body: { thread: state.currentThread.id, user: currentUserId(), text },
      });
      state.posts.push(post);
      renderThread();
      renderThreadList();
      toast('Mensaje publicado ✔');
    } catch (err) {
      if (err.data?.moderation) {
        throw new Error(`🛡️ La IA bloqueó el mensaje: ${err.data.moderation.reason}`);
      }
      throw err;
    }
  });
}

function askForum(event) {
  event.preventDefault();
  const question = $('#ask-input').value.trim();
  if (!question) return toast('Escribe una pregunta', 'error');

  return withLoading($('#ask-btn'), async () => {
    const r = await api('/api/ai/ask', { method: 'POST', body: { question } });
    const sources = r.sources
      .map((s) => `<a class="source" href="#/thread/${s.threadId}"><b>${esc(s.title)}</b><span>${esc(s.reason)}</span></a>`)
      .join('');
    $('#ask-result').innerHTML = `<div class="ask-answer">
      <p>${esc(r.answer)}</p>
      <div class="sources">${sources}</div>
      ${aiMeta(r)}
    </div>`;
  });
}

async function createThread(form) {
  const data = new FormData(form);
  try {
    const thread = await api('/api/threads', {
      method: 'POST',
      body: { title: data.get('title'), tag: data.get('tag'), createdBy: currentUserId() },
    });
    const post = await api('/api/posts', {
      method: 'POST',
      body: { thread: thread.id, user: currentUserId(), text: data.get('text') },
    }).catch((err) => toast(err.data?.moderation ? `🛡️ ${err.data.moderation.reason}` : err.message, 'error'));
    state.threads.unshift(thread);
    if (post) state.posts.push(post);
    form.reset();
    location.hash = `#/thread/${thread.id}`;
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------- Architecture panel ---------- */

const DESCRIPTIONS = {
  users: 'Perfiles · GET /api/users',
  threads: 'Hilos · GET/POST /api/threads',
  posts: 'Mensajes · moderados por IA',
  ai: 'Claude · resúmenes, preguntas, moderación',
};

async function refreshHealth() {
  let health;
  try {
    health = await (await fetch('/api/health')).json();
  } catch {
    health = { healthy: false, services: [], gateway: { status: 'down' } };
  }
  $('#health-dot').className = `dot ${health.healthy ? 'up' : 'down'}`;
  const node = (cls, status, name, sub, lat = '') =>
    `<div class="node ${cls}"><span class="dot ${status}"></span>
      <div><div class="name">${name}</div><div class="sub">${sub}</div></div><span class="lat">${lat}</span></div>`;

  $('#architecture').innerHTML = `
    ${node('client', 'up', '🌐 Navegador', 'Este SPA')}
    <div class="edge"></div>
    ${node('gateway', health.gateway.status, '🚪 API Gateway', 'Koa · proxy + estáticos · :8080')}
    <div class="fanout">
      ${health.services
        .map((s) => {
          const extra = s.mode ? ` · ${s.mode}` : s.count != null ? ` · ${s.count} items` : '';
          const traffic = s.requests != null ? ` · ${s.requests} req${s.errors ? ` · ${s.errors} err` : ''}` : '';
          return node('', s.status, s.name, `${DESCRIPTIONS[s.name] ?? ''}${extra}${traffic}`, `${s.latencyMs}ms`);
        })
        .join('')}
    </div>`;
}

async function refreshAiBadge() {
  try {
    const s = await api('/api/ai/status');
    const badge = $('#ai-badge');
    badge.className = `badge ${s.mode}`;
    badge.textContent = s.mode === 'claude' ? `● IA: Claude (${s.model})` : '● IA: modo demo';
    badge.title = s.hint ?? '';
  } catch {
    $('#ai-badge').textContent = '● IA: sin conexión';
  }
}

/* ---------- Live updates ---------- */

// Adds what another tab (or this one) just created, without wiping what the user is typing
function receivePost(post) {
  if (state.posts.some((p) => p.id === post.id)) return;
  state.posts.push(post);
  renderThreadList();
  if (state.currentThread?.id !== post.thread) {
    const thread = state.threads.find((t) => t.id === post.thread);
    toast(`💬 ${userById(post.user).name} escribió en «${thread?.title ?? 'un hilo'}»`);
    return;
  }
  const list = $('.posts');
  list.insertAdjacentHTML('beforeend', postHtml(post));
  list.lastElementChild.classList.add('fresh');
  $('.thread-header .meta').textContent = threadMeta(state.currentThread);
}

function receiveThread(thread) {
  if (state.threads.some((t) => t.id === thread.id)) return;
  state.threads.unshift(thread);
  renderThreadList();
  toast(`🧵 Nuevo hilo: «${thread.title}»`);
}

function connectLive() {
  const badge = $('#live-badge');
  const setLive = (on) => {
    badge.lastChild.textContent = on ? 'En vivo' : 'Reconectando…';
    badge.firstChild.className = `dot ${on ? 'up' : 'down'}`;
  };
  // EventSource reconnects by itself; we only reflect the state
  const source = new EventSource('/api/events');
  source.onopen = () => setLive(true);
  source.onerror = () => setLive(false);
  const handle = (receive) => (e) => {
    const { requestId, item } = JSON.parse(e.data);
    if (myRequests.delete(requestId)) return;
    receive(item);
  };
  source.addEventListener('post', handle(receivePost));
  source.addEventListener('thread', handle(receiveThread));
}

/* ---------- Theme ---------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme-btn').textContent = theme === 'dark' ? '☀️' : '🌙';
  $('#theme-btn').title = theme === 'dark' ? 'Tema claro' : 'Tema oscuro';
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem('theme', next);
  } catch {}
}

/* ---------- Routing & boot ---------- */

function route() {
  const id = parseInt(location.hash.match(/#\/thread\/(\d+)/)?.[1] ?? state.threads[0]?.id);
  state.currentThread = state.threads.find((t) => t.id === id) ?? null;
  renderThreadList();
  renderThread();
}

async function boot() {
  refreshHealth();
  setInterval(refreshHealth, 5000);
  try {
    [state.users, state.threads, state.posts] = await Promise.all([
      api('/api/users'),
      api('/api/threads'),
      api('/api/posts'),
    ]);
  } catch (err) {
    toast(`No se pudo cargar el foro: ${err.message}`, 'error');
  }
  renderUsers();
  refreshAiBadge();
  route();
  connectLive();
}

window.addEventListener('hashchange', route);
$('#new-thread-btn').onclick = () => $('#new-thread-dialog').showModal();
$('#ask-form').onsubmit = askForum;
$('#theme-btn').onclick = toggleTheme;
applyTheme(document.documentElement.dataset.theme);
$('#new-thread-form').addEventListener('submit', (e) => {
  if (e.submitter?.value === 'ok') createThread(e.target);
});

boot();
