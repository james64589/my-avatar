# Avatar — Spec & API Contract

## 1. The product (one paragraph)

Avatar is a personal **digital-twin** platform. A visitor to the landing page (`/`) chats with an AI twin of the site's owner, powered by OpenRouter. The owner can join the conversation silently from `/admin` and post their own message — rendering as a **human** bubble (photo, yellow ring, glow, "live" tag) — so that conversations are truly three-way: visitor ↔ avatar ↔ human.

The platform is built as a single Docker container: FastAPI serves both the backend API and the static frontend at `serving/*`. The frontend is vanilla TypeScript + Vite (no framework), using only pure CSS from the design system (`data-theme="dark"|"light"` on <html>). All icons come from `icons.svg` sprites.

---

## 2. Design-system source of truth (frontend appearance)

- **`design-system/tokens.css`** — single source for brand colors, surface palette, type scale, spacing, radii, motion, and dark/light theme variables.
- **`design-system/components.css`** — all component classes (buttons, fields, switch, avatars, three role-based message bubbles, tool-status, composer, inbox rows).
- **`design-system/icons.svg`** — icon sprite: `<use href="icons.svg#i-send">`. Inheriting `currentColor`.

When the SPEC and design-system diverge on *appearance*, the design-system wins. When they conflict on *behaviour* (how the product works), the SPEC wins.

---

## 3. Frontend entrypoint & asset delivery

**`frontend/index.html`**:

```html
<!doctype html>
<html lang="en" data-theme="dark">            <!-- dark=default, localStorage-backed -->
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.ico">
<title>Avatar | Ed Donner</title>
</head>
<body>
<div id="root"></div>
<script type="module" src="/src/main.ts"></script>
</body>
</html>
```

**`frontend/src/main.ts`**: injects the theme into `data-theme`, checks localStorage, no state logic.

Vite bundles to `dist/web/*.js` (+ assets), which are then copied to the container's `/static` directory so that `GET /serving/js/index.js` returns the SPA entry point (Vite's base path is `'//'` in dev, `/` at build time).

---

## 4. API endpoints (FastAPI routes)

### Visitor routing (public, no auth)

| Route | Method | Description | Response |
|---|---|---|---|
| `/serving/js/index.js` | GET | SPA entry point (Vite-bundled index.ts → root.innerHTML). | 200 `text/javascript` |
| `/api/messages` | POST | Send visitor message. Body: `{ conversation_id, sender: "visitor", content }`. | 201 creates a new message row + fetches latest from database and returns the full list. |
| `/api/messages/{conv_id}` | GET | Fetch latest N messages for conversation `conversation_id` (indexed by `(conv_id,updated_at)` desc). Pagination: default last 50, max 200. | 200 → list of `{ id, conversation_id, sender, content, created_at, updated_at }` rows. |
| `/api/q={n}` | GET | Instantiate an instant answer (no LLM call): `{ id, conversation_id, content, sender: "visitor", role: "instant-answer" }`. | 200 → a response that sets the `role` flag in the database row so the human admin knows it was auto-suggested. |
| `/admin/login` | POST | Admin authentication. Body: `{ password }`. On success, set httpOnly session cookie with value of `ADMIN_PASSWORD` (see SECURITY). | 200 `{ ok: true, token?: string }`. If wrong → 401 `{ ok: false, error: "invalid credentials" }`. |
| `/admin/conversations` | GET | List all conversations (indexed by `(conv_id,count(messages),updated_at)` desc). Pagination param `page` (from 1), default 1. | 200 → list of `{ id, conversation_id, name, unread, count, last_message_time, needs_attention }`. |
| `/admin/conversations/{cid}` | GET | Fetch a single conversation thread (all messages). | 200 → sorted by `created_at` asc, `{ id, conversation_id, sender, content, created_at, updated_at, needs_attention, unread }`. |

### Admin API authentication

All `/admin/*` routes require a valid session cookie (`SESSION_SECRET=httpOnly` or `ADMIN_PASSWORD` hash). Only the admin (the site owner) can call these APIs. For the local implementation, the session is validated against `ADMIN_PASSWORD` (case-sensitive string matching against what was submitted on login). This implementation is *not* sufficient for production — replace it with a JWT-based auth strategy that hashes the password and validates each request.

### Messages API (public & admin)

The backend exposes message storage in Supabase:

**Write**: `POST /api/messages` or `PUT /api/messages/{id}`
- Body: JSON with `{ conversation_id, sender, content }` → a new message row is persisted in Supabase `messages(id primary gen-by-postgres, conversation_id uuid, sender text, content text, created_at timestamptz)` table.

**Read**: `GET /api/messages/{conversation_id}/{pagination}` — returns the latest N rows for a given conversation, ordered by `created_at` asc.

### Admin-only endpoints

| Route | Method | Description |
|---|---|---|
| `POST /admin/conversations/{cid}/messages` | POST | Add a new message as the human. Body: `{ content }`. The newly created row has `sender = "human"`, no automatic reply. |
| `PUT /admin/conversations/{cid}` | PUT | Set conversation metadata (`name`, optional `unsubscribed`). |
| `POST /admin/thumbs` | POST | Create a new row in Supabase's thumbs table (for future UI upgrades). |
| `PUT /admin/settings` | PUT | Save owner settings to Supabase profile. |

---

## 5. Conversation & Message types (TypeScript interface)

```typescript
interface MessageRow {
  id: string                // surrogate PK; `conversation_id` is the stable key
  conversation_id: string    // UUID v4, generated once per session
  sender: 'visitor' | 'avatar' | 'human'
  content: string
  created_at: string        // ISO8601 timestamptz; displayed at hh:mm AM/PM
  updated_at?: string       // used for delta comparison when streaming updates
  needs_attention?: boolean // set by push_tool → admin knows to notify the owner
  unread?: boolean          // admin inbox: unread = `false` initially, read when a thread is opened
}

interface Conversation {
  id: string                // surrogate PK, stable in UI
  conversation_id: string   // stable ID for Supabase + SSE
  name: string              // optional; derived from first_message content if missing.
  first_message_time?: Date // timestamp of the oldest message
  count: number             // message count per thread (derived)
  needs_attention: boolean  // from `push_tool` notification; cleared when admin opens
  unread: boolean           // admin inbox: false means unopened by owner
}
```

### Message bubble role flags (CSS selection)

| Role | Bubble class | CSS rule | Identity / styling |
|---|---|---|---|
| visitor | `.msg--visitor` | `flex-direction: row-reverse; align-self: flex-end;` | Right-aligned, blue token initials, neutral bubble background (`surface-2`) |
| avatar | `.msg--avatar` | `align-self: flex-start;` | Left-aligned, cyan ring `role-avatar:#3bb6c9`, displays tool-status above bubble |
| human | `.msg--human` | `flex-direction: row-align-items: ...;` + special glow | Left-aligned, yellow ring `role-human`, glow `glow-yellow` background gradient (yellow-soft padding-box + surface-2 inset), no name is ever shown — just the photo with a spark badge (“The human · live”) |

The backend never mixes up the role in the Supabase row's `sender` text field (it remains `'visitor'/'avatar'/'human'`). The UI derives the visual style purely from this value.

---

## 6. Admin inbox & notifications

**Persistence**: needs_attention and unread are both row-level booleans on the message table in Supabase:

| Field | Description |
|---|---|
| `needs_attention` | true whenever the Avatar fires the `push_tool` on the current active visitor conversation → the admin is notified via Pushover. |
| `unread` | false initially (means "not opened by owner yet"). When the owner clicks a conversation in the inbox sidebar, *every row* for that `conversation_id` is updated (`SET unread = false`) and returned to the front-end admin panel for rendering with the checkmark icon. |

**Notification flow (future enhancement for SPEC)**:
1. Visitor sends a message → backend stores new row → calls `push_tool` if conversation has no push_tool notification yet within last 60s.
2. If `push_tool` fires: a new Pushover `user_id` is resolved from `PUSHOVER_USER`, and a `http://api.pushover.net/v1/messages.json` request (HTTPS only) is posted to the Pushover service's endpoint at `https://api.pushover.net/v1/messages.json` with `token`=`{PUSHOVER_TOKEN}` and `user`=`{PUSHOVER_USER}`. The body: title="Avatar", message="Visitor says: {content}", sound="pushover".

---

## 7. Abuse guards (in-spec, no configuration)

### Abuse guard #1: message length clamp

When the visitor submits a message longer than **20,000 characters**, the backend truncates to the first 20,000 chars and appends `[...]` (append a note about truncation before sending to LLM). The truncated string is what is stored in Supabase. This prevents any single post from exhausting the per-conversation allowance on OpenRouter.

### Abuse guard #2: conversation rate-limiting

Each `conversation_id` is subject to a sliding-window rate limit of **20 messages per minute**. The backend uses the `limits` package (in-memory per-process) to enforce this. Requests exceeding the quota return HTTP 429 with a friendly message (“you're sending too quickly — cool it off for a bit”). This is sufficient because each browser session sticks to one machine and OpenRouter already limits total spend from the key provided in `.env`.

---

## 8. The LLM call (OpenRouter + OpenAI Agents SDK)

**Model selection**: read `MODEL` environment variable (default `'gpt-5.4-nano'`). Always prefixed with `openai/`, so a production deploy might use `openai/gpt-5.4-mini`. Model can be overridden by the owner in their `.env`.

**Prompt composition**:
```typescript
const system_prompt = `${knowledge.md} ${style.md}`; // first-person profile + voice rules
const context_messages = buildHumanAvatarDialogue(current_messages); // 3-way dialog
const user_message = [{ role: "user", content: "summarize all turns + current intent" }];
```

The system message is merged from `knowledge/knowledge.md` (the owner's real first-person bio and constraints), `knowledge/style.md` (tone, formatting, safety rules) and `[FAQ]`. It explains that **this is a digital twin talking to a visitor**, not a generic Q&A chat, and that the twin should not act human when responding to a visitor message. The system prompt is *static* — it never mentions what the human has typed, because that would break the illusion (and the user experience) of a seamless dialogue between the visitor and the twin.

---

## 9. Human-in-the-loop rule (SPEC Q&A #4)

1. The **human posts from the admin panel** with `sender='human'`.
2. The **Avatar does NOT auto-reply** to the human's message in the same thread — only on the *next* visitor message. The visitor sees only the human’s own message as a separate bubble: photo + yellow ring + no name (“The human · live”).
3. The system prompt (fed into every LLM call) includes *all* prior turns in chronological order, including the human’s latest input — so the avatar can correctly continue the conversation as if it were a natural 3-way dialogue.

The rule is enforced purely by the frontend rendering logic and the sequence of POST/POLL requests: never does the backend attempt an immediate reply on `PUT /admin/...`; it simply inserts a new `.msg--human` row with its own timestamp.

---

## 10. Deployment & Docker

**Dockerfile strategy**:
```dockerfile
# Build step: install deps from backend (v1.3 folder + uv.lock, venv), then build:
USER root
RUN cd /app/backend && uv pip install -r ./backend-requirements.txt
USER vscode
RUN cd /app/frontend && npm install -D scss && npm run build

# Runtime: copy the frontend build to /static/ via serving/*
FROM python:3.12-slim-bookworm as runner
# expose 3000 (Flask) for fly.io's serving/*
WORKDIR /app
COPY --from=builder /app/static /static
...
```

**Fly.io**: a single container (no multi-container, no Redis, no PostgreSQL — all data is in Supabase). Fly maps ports via port mappings: the app runs on container internal port 3000 (Flask) and the same `serving/*` prefix, so `fly.io` never needs to re-proxy anything. The custom domain is configured via a CNAME to `<hash>.<app>.fly.dev`.

---

## 11. Test plan (per SPEC §Testing)

1. **Backend unit tests**: assert that admin-only routes return 401 if no valid session cookie; assert rate-limiting for >20 msgs/min per conversation_id.
2. **Playwright E2E** (3 conversations × dark/light themes): visitor chats / Q2 instant answer / avatar replies; admin login → list inbox → open thread → post message / mark attention → visitor receives push notification; end-to-end human moment (visitor asks for connection → twin fires push_tool → owner sees badge → adds reply message).
3. **Docker build**: `docker buildx bake release` → load image and run `fly deploy --force`, then run Playwright on the live container (HTTP 3000 via the app's `serving/*`).

---

## Appendix A: Message bubble reference design (mockups)

| Element | CSS class | Appearance / styling |
|---|---|---|
| top bar: brand mark + name | `.topbar` | `display:flex; gap:var(--space-4); padding:0 var(--space-6); flex:none; border-bottom:1px solid var(--border); background:var(--surface-1);` |
| message rows container | `.chat .convo` | `flex:1;display:inline-flex;flex-direction:column;overflow:hidden` |
| message bubble | `.bubble` | `padding:var(--space-3) var(--space-4); border-radius:var(--radius-lg); font-size:1.0625em; line-height:var(--leading-relaxed);` |
| visitor-aligned | `.msg--visitor .bubble` | background: `--surface-2`, border: `transparent 1px solid --border` (right-bottom corner clipped) |
| avatar-aligned | `.msg--avatar .bubble` | background: `--surface-1` (dark mode: `--surface-2`), border: `transparent 1px solid --border` (left-bottom corner clipped) |
| human-aligned | `.msg--human .bubble` | background gradient (`--yellow-soft`) + yellow ring (`glow-yellow`), no text identity shown in the UI; only the photo + spark badge ("The human · live") is rendered visually. |

---

## Appendix B: Human moment (visitor vs owner)

1. Visitor asks: "Can I talk to Ed directly?" → Avatar fires `push_tool` notification → admin's Pushover alert appears.
2. Owner opens inbox in `/admin`, sees thread with badge "Needs you", taps the conversation → `unread=false`, `needs_attention` cleared → admin posts from the composer: "Hey Jordan — it's actually me, jumping in..."
3. Visitor sees: new message bubble (`.msg--human`) — **no name shown**, just the owner's photo + `"The human · live"` tag + yellow glow.
4. Avatar reply on *next* visitor message uses all prior turns (`visitor → avatar → human → visitor`) as context in a single LLM call, and the avatar replies from its own cyan ring bubble (`.msg--avatar`).
