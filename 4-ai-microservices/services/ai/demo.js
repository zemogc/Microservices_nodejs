// Deterministic stand-in for Claude, used when no API key is configured or the
// API call fails. It keeps the whole platform usable offline and in tests.

const STOPWORDS = new Set(
  ('para como pero porque cuando donde desde hasta sobre entre este esta estos estas eso esto ' +
    'algo alguien también tengo tiene tienen puede pueden quiero otra otro mañana allá aquí ' +
    'nuestra nuestro mucho muchos todos todas cosas semana señal necesita necesito suena ' +
    'habrá vengan llevo paso revisar sigue antes hilo acaso buena bueno demasiado últimamente gustaría').split(' ')
);

const POSITIVE = ['fiesta', 'matemático', 'hermosa', 'sabrosos', 'gracias', 'genial', 'pastel', 'música', 'torneo', 'amigo', 'excelente'];
const NEGATIVE = ['lich', 'callada', 'pelear', 'peligro', 'subieron', 'malo', 'triste', 'problema', 'odio'];

const BLOCKLIST = ['idiota', 'estúpido', 'estupido', 'imbécil', 'imbecil', 'tarado', 'odio a', 'idiot', 'stupid', 'hate you'];

// Each voice gets who spoke last ("Bonnibel") and the main keyword of the thread ("sensores")
const VOICES = {
  marceline: (who, topic) => `Jaja, ${who}, lo de ${topic} me gusta cómo suena. Llevo el bajo y le ponemos banda sonora.`,
  finn: (who, topic) => `¡Matemático, ${who}! Cuenten conmigo para lo de ${topic}. Llevo la espada por si acaso.`,
  pb: (who, topic) => `Buen punto, ${who}. Analizo lo de ${topic} con datos y comparto un plan hoy mismo.`,
  jake: (who, topic) => `Tranqui, ${who}, lo de ${topic} se resuelve. Yo me estiro y llego primero, ¿quién trae sándwiches?`,
  bmo: (who, topic) => `¡BMO está emocionado, ${who}! Lo de ${topic} suena divertido. BMO puede grabarlo todo en video.`,
  simon: (who, topic) => `${who}, lo de ${topic} me recuerda algo de antes de la guerra... Puedo buscar en mis notas.`,
};

const words = (text) =>
  text
    .toLowerCase()
    .normalize('NFC')
    .match(/[a-záéíóúñü]+/g) ?? [];

function topKeywords(posts, n = 3) {
  const counts = new Map();
  for (const p of posts) {
    for (const w of words(p.text)) {
      if (w.length < 5 || STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([w]) => w);
}

function sentimentOf(posts) {
  let score = 0;
  for (const w of posts.flatMap((p) => words(p.text))) {
    if (POSITIVE.includes(w)) score++;
    if (NEGATIVE.includes(w)) score--;
  }
  if (score > 1) return 'positivo';
  if (score < -1) return 'negativo';
  return score === 0 ? 'neutral' : 'mixto';
}

const listOf = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : items[0] ?? '');

const shorten = (text, max = 90) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function summarize({ thread, posts, users }) {
  const nameOf = (id) => users.find((u) => u.id === id)?.name ?? `usuario ${id}`;
  const people = [...new Set(posts.map((p) => nameOf(p.user)))];
  const first = posts[0];
  const last = posts[posts.length - 1];
  const topics = [thread.tag, ...topKeywords(posts)].filter(Boolean);

  const summary = !posts.length
    ? `El hilo «${thread.title}» todavía no tiene mensajes.`
    : `«${thread.title}» reúne ${posts.length} mensajes de ${listOf(people)}. ` +
      `${nameOf(first.user)} abrió con: “${shorten(first.text)}”` +
      (last !== first ? ` y lo último lo aportó ${nameOf(last.user)}: “${shorten(last.text)}”.` : '.');

  return {
    summary,
    sentiment: sentimentOf(posts),
    topics: [...new Set(topics)].slice(0, 4),
    nextSteps: posts.length
      ? [`Responder a ${nameOf(last.user)}`, 'Invitar a quienes aún no participan']
      : ['Escribir el primer mensaje'],
  };
}

function suggestReply({ thread, posts, users }, author) {
  const last = posts[posts.length - 1];
  const who = last ? users.find((u) => u.id === last.user)?.name.split(' ')[0] ?? 'amigos' : 'amigos';
  const topic = topKeywords(posts, 1)[0] ?? thread.tag ?? 'esto';
  const voice = VOICES[author.username] ?? ((w, t) => `Me parece interesante lo de ${t}, ${w}. ¿Cómo puedo ayudar?`);
  return { reply: voice(who, topic) };
}

function moderate(text) {
  const lower = text.toLowerCase();
  const insults = BLOCKLIST.filter((w) => lower.includes(w));
  const letters = text.replace(/[^a-zA-ZÁÉÍÓÚÑ]/g, '');
  const shouting = letters.length > 20 && letters === letters.toUpperCase();
  const links = (text.match(/https?:\/\//g) ?? []).length;

  const categories = [];
  if (insults.length) categories.push('insultos');
  if (links > 2) categories.push('spam');

  if (categories.length) {
    return { allowed: false, reason: `Detecté contenido no permitido (${categories.join(', ')}).`, categories };
  }
  return {
    allowed: true,
    reason: shouting ? 'Permitido, aunque está todo en mayúsculas.' : 'No se detectó contenido problemático.',
    categories: [],
  };
}

module.exports = { summarize, suggestReply, moderate };
