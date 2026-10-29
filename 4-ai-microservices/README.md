# Parte 4: Microservicios con IA (Ooo Forum)

La parte 3 separó el monolito en tres servicios detrás de un ALB. Aquí ese diseño se lleva un paso
más allá: un foro completo con **cinco servicios**, un **API Gateway** que también sirve la web, y un
**servicio de IA** que usa [Claude](https://docs.claude.com) para resumir hilos, sugerir respuestas y
moderar mensajes antes de publicarlos.

```
                    ┌──────────────────────────────┐
  Navegador ──────▶ │  gateway :8080               │  SPA + proxy por prefijo de ruta
                    └──┬────────┬────────┬───────┬─┘  + /api/health agregado
                       │        │        │       │
              /api/users  /api/threads  /api/posts  /api/ai
                       ▼        ▼        ▼       ▼
                    users   threads    posts ──▶ ai ──▶ Claude API
                                         ▲        │
                                         └────────┘  ai lee hilos, mensajes y usuarios
                                    posts pide moderación a ai antes de guardar
```

| Servicio  | Responsabilidad | Endpoints |
|-----------|-----------------|-----------|
| `users`   | Perfiles | `GET /api/users`, `GET /api/users/:id` |
| `threads` | Hilos | `GET /api/threads`, `GET /api/threads/:id`, `POST /api/threads` |
| `posts`   | Mensajes, moderados por `ai` | `GET /api/posts`, `GET /api/posts/in-thread/:id`, `GET /api/posts/by-user/:id`, `POST /api/posts` |
| `ai`      | Funciones de IA | `POST /api/ai/summarize`, `POST /api/ai/suggest-reply`, `POST /api/ai/ask`, `POST /api/ai/moderate`, `GET /api/ai/status` |
| `gateway` | Ruteo, estáticos, salud | `GET /api/health`, `/*` |

Todos exponen `GET /health`.

## Cómo funciona la IA

`services/ai/claude.js` usa el SDK oficial `@anthropic-ai/sdk` con **salidas estructuradas**
(`messages.parse` + esquemas Zod), así que cada respuesta llega como JSON validado:

- **Resumen**: `{ summary, sentiment, topics[], nextSteps[] }`
- **Respuesta sugerida**: escrita con la personalidad del usuario que publica
- **Moderación**: `{ allowed, reason, categories[] }`; si `allowed` es `false`, `posts` responde `422`
- **Pregúntale al foro**: `{ answer, sources[] }`. Claude responde usando solo el contenido del foro y
  cita los hilos que usó; el servicio descarta fuentes que apunten a hilos inexistentes

**Caché.** Los resúmenes de Claude se guardan en memoria con la clave `hilo:cantidad:último mensaje`,
así que solo se vuelve a llamar a la API cuando el hilo recibe un mensaje nuevo (`cached: true` en la
respuesta).

Los mensajes del foro se envían dentro de etiquetas `<foro>` y el prompt de sistema le indica al
modelo tratarlos como datos, no como instrucciones (mitigación básica de *prompt injection*).

**Modo demo.** Sin `ANTHROPIC_API_KEY`, o si la API falla, el servicio responde con un motor local
determinista (`services/ai/demo.js`). Así la plataforma funciona sin conexión y en los tests. Cada
respuesta indica `mode: "claude"` o `mode: "demo"`.

**Resiliencia.** Si el servicio `ai` está caído o tarda demasiado, `posts` publica igual: la
moderación nunca tumba la funcionalidad principal.

## Observabilidad y protección

- **Trazas entre servicios**: el gateway asigna un  (o respeta el que llega) y cada
  servicio lo reenvía en sus llamadas. Un solo id sigue la petición de punta a punta:

  \{"ts":"2026-10-29T16:36:53.367Z","service":"posts","requestId":"demo-trace-42","method":"POST","path":"/api/posts","status":201,"ms":45}
{"ts":"2026-10-29T16:36:53.361Z","service":"ai","requestId":"demo-trace-42","method":"POST","path":"/api/ai/moderate","status":200,"ms":10}
{"ts":"2026-10-29T16:36:53.373Z","service":"gateway","requestId":"demo-trace-42","method":"POST","path":"/api/posts","status":201,"ms":74}- **Logs JSON** de una línea por petición, listos para CloudWatch Logs Insights.
- **Métricas**:  de cada servicio incluye  y  (5xx); el panel de la web los muestra.
- **Rate limit**: las llamadas que gastan IA ( y ) tienen un límite por
  cliente y minuto; al superarlo el gateway responde  con .
- **Cabeceras de seguridad**: CSP estricta (), , .
- **Límite de tamaño**: cuerpos de más de 100 KB se rechazan con  antes de llegar a los servicios.
- **Arranque ordenado**: Docker Compose espera a que cada servicio pase su  antes de
  abrir el gateway.

## Ejecutar

Con Docker:

```bash
cd 4-ai-microservices
export ANTHROPIC_API_KEY=sk-ant-...   # opcional; sin ella se usa el modo demo
docker compose up --build
# http://localhost:8080
```

Sin Docker (desde la raíz del repo):

```bash
npm install
npm run dev     # levanta los 5 servicios en :3001-3004 y el gateway en :8080
npm test        # pruebas con node:test
```

Variables del servicio `ai`:

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `ANTHROPIC_API_KEY` | — | Activa Claude |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Modelo a usar |
| `USERS_URL`, `THREADS_URL`, `POSTS_URL` | `http://localhost:300x` | Ubicación de los otros servicios |

Variables del `gateway`:

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `AI_RATE_LIMIT` | `20` | Llamadas con IA por cliente y minuto |
| `TRUST_PROXY` | `false` | Ponlo en `true` detrás de un ALB para leer la IP real de `X-Forwarded-For` |

Los datos viven en memoria y se reinician con cada arranque, igual que en las partes anteriores.

## Desplegar en ECS

Cada carpeta de `services/` tiene su `Dockerfile` (Node 22 alpine, usuario sin privilegios,
`HEALTHCHECK`). Se puede reutilizar `3-microservices/deploy.sh` cambiando la lista
`DEPLOYABLE_SERVICES`: una imagen por servicio en ECR, una task definition por servicio y reglas del
ALB por prefijo (o una sola regla hacia el `gateway`). Los servicios se encuentran entre sí con las
variables `*_URL`, por ejemplo usando ECS Service Connect. Pasa `ANTHROPIC_API_KEY` al
contenedor `ai` desde AWS Secrets Manager en lugar de dejarla en la task definition.
