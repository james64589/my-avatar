# Avatar 重構完成 (2026/08/23)

## 已完成的專案結構

```
avatar-main/
├── design-system/          # 複製自 https://github.com/ed-donner/avatar
│   ├── tokens.css          # Design tokens: brand colors, surface palette, type scale
│   ├── components.css      # 100 個+ 組件 class, hover states, theme vars
│   ├── icons.svg           # 20+ 枚 icon sprite
│   ├── assets/             # avatar-human.png, avatar-robot-*.png (3 張)
│   └── mockups/            # Visitor Chat.html + Admin Dashboard.html
├── backend/                # 後端將由 SPEC.md + 設計系統驅動 (後期創建)
├── frontend/               # Vite + vanilla-ts, NO framework
│   ├── vite.config.ts      # output → dist/web/ (fly.io serving /*)
│   ├── index.html          # dark theme persist (localStorage), base path /
│   ├── package.json        # typescript ~6.0, vite 8.2
│   ├── src/
│   │   ├── main.ts         # 注入: tokens.css + app container (#root)
│   │   └── components/      # mockups → components (tokens → CSS var mapping)
│   └── public/
│       └── assets/
├── Dockerfile              # 後續階段：build frontend → dist/web → fly.io serve
└── SPEC.md                 # 行為規範 + 測試計畫
```

## 技術決策

1. **前端: vanilla TypeScript + Vite** — 無 React/Vue。所有 UI 直接從 `design-system/mockups/*.html` 擷取 HTML 結構，搭配 `components.css` class 組合。
2. **CSS:** `tokens.css` → `CSS (data-theme="dark"|"light")` — 無 SCSS/LESS。直接 copy；無編譯步驟。避免 v1.3 錯誤的 `.scss` 污染。
3. **Vite build:** `outDir: dist/web` — Fly.io `serving/*` 可直接取，無需額外路由層。
4. **圖形資產:** `public/assets/` → PNG/JPG (avatar-robot*)、SVG (icons).

## 後續步驟（待實作）

1. **api-wire.ts** (/api/messages: POST visitor→avatar, Qn instant, SSE stream; /admin/login, /admin/conversations, /admin/conversations/:id/messages, /admin/api/send)
2. **Dockerfile:** `COPY dist/web/* /app/static/`, `EXPOSE 3000`, `fly.io` deploy
3. **Playwright E2E test:** visitor chat / Qn / admin login / 多會話 / human moment (push_tool notification)

設計系統已 100% 導入——視覺完全由 `design-system/tokens.css+components.css` 控制，SPEC.md 定義後端 + API。
