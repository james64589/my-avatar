# Avatar 重構進度報告 (2026/08/23)

## ✅ 已完成的基礎結構

`frontend/` — 乾淨的 Vite + vanilla-ts (無 SCSS, 無 React/Vue):

| 檔案 | 狀態 | 說明 |
|---|---|---|
| `vite.config.ts` | ✅ | `outDir:../dist/web`, entry=`, assetFileNames=assets/[name][ext]` |
| `index.html` | ✅ | `data-theme="dark"`, base-path `/` |
| `package.json` | ✅ | typescript~6.0, vite 8.2, no framework |
| `tsconfig.json` | ✅ | ES2023 target, module=bundler, noEmit=true, noUnusedLocals=false |
| `src/main.ts` | ✅ | 注入 theme, localStorage-backed; 無狀態 |

CSS: pure, no SCSS compile

| 檔案 | 狀態 |
|---|---|
| `frontend/src/assets/tokens.css` | ✅ (from design-system) |
| `frontend/public/assets/icons.svg` | ✅ |
| `design-system/` (mockups/assets/docs/tokens/css) | ✅ copy-complete |

SPEC.md: API 合約 + types + human moment

| section | 狀態 |
|---|---|
| API endpoints + types | ✅ |
| Message bubble flags (.msg--visitor/.human/.avatar) | ✅ |
| Admin inbox logic (needs_attention, unread) | ✅ |
| Q&A #4: human-in-the-loop 規則 | ✅ |

---

## 📋 待實作

| 任務 | 優先級 | 說明 |
|---|---|---|
| `api-wire.ts` → 串接 `/api/messages` (POST, Qn/SSE), `/admin/*` (login, conversations) + human polling (10s→60s) | high | SPEC §4.3 + §5 |
| Vite output → `dist/web` asset mapping (fly.io serving/* 可直接存取 /css/*.css, /assets/*.js) | medium | 需確認 rollup output paths |
| Dockerfile → build stage: backend deps + frontend bundle → runtime copy to static/ → fly.io deploy | high | 單一 Container，無 Redis/PG |

---

## 🧪 測試計畫 (SPEC §Testing)

- Playwright E2E(3 個會話 x 暗光樣式):  
  1. 訪客聊天 (Q2 instant) → 後端 reply with tool-status  
  2. admin 登入 → 收信 (needs_attention) → 點入讀取(reads+unread=false) → 發文(human) → 訪客收到 pushover 通知  
- 3 個會話 x 暗光樣式，每場景的聊天串流 + human moment；截圖存 test/screenshots/

---

## 🔧 Design-system 檔案清單

`design-system/`:

```
tokens.css                         (brand, surfaces, dark/light themes)
components.css                     (100+ components, hover states, .css-rule for each)
icons.svg                          (20+ icon sprite; <use href="i-send"/>)
assets/avatars/human.jpg           (square crop of pic.jpg)
assets/avatars/robot-round.png     (twin: posterized 2-panel navy→cyan + scanlines + glowing eyes)
mockups/visitor-chat.html          (reference hi-fi: topbar, composer, msg rows, human moment)
README.md + SKILL.md               (build brief for Claude Code — how to produce the product UI from tokens/components)
docs/avatar-generation.md      (regen twin image from pic.jpg per owner; doc/code for owner-specific branding)
```

---

## 📃 相關文件

- `SPEC.md` — API contracts, TypeScript types, admin inbox/rules, abuse guards (length clamp + 20 rpm), LLM call flow, human-in-the-loop spec。
- `FINISH.md` — 2026/08/23: frontend rebuild, api-wire wireframe, docker + fly.io strategy

