// CSS 打包工具 : tokens.css + components.css → dist/
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SOURCE = path.join(__dirname, '..', 'src', 'ds')
const OUTPUT = path.join(__dirname, '..', 'dist')
fs.mkdirSync(OUTPUT, { recursive: true })

// ========== 提取 tokens :root (黑暗模式) ==========
let tokensRoot = `/* Avatar Design Tokens — Compiled by build-css.ts */
`.trim() + `
:root {
  /* Brand palette (fixed, from SPEC):          */
  --brand-yellow:   #ecad0a;
  --brand-blue:     #209dd7;
  --brand-purple:   #753991;
  --brand-navy:     #032147;                /* dark mode canvas */
  --brand-gray:     #888888;

  /* Typography families    */
  --font-display: "Newsreader", Georgia, "Times New Roman", serif;
  --font-sans: "Hanken Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;

  /* Type scale (root 16px)  */
  --text-2xs:0.6875rem; --text-xs:0.75rem; --text-sm:0.8125rem;
  --text-base:0.9375rem;--text-md:1.0625rem; --text-lg:1.375rem;
  --text-xl:1.875rem;   --text-2xl:2.5rem;   --text-3xl:3.5rem;
  --leading-tight: 1.07; --leading-snug: 1.28; --leading-normal: 1.5; --leading-relaxed: 1.62;
  --tracking-caps: 0.14em; --tracking-wide: 0.04em; --tracking-tight: -0.02em;

  /* Spacing (4px base)    */
  --space-0:0; --space-1:4px;  --space-2:8px;   --space-3:12px;
  --space-4:16px;--space-5:20px; --space-6:24px; --space-7:32px;
  --space-8: 40px; --space-9: 48px; --space-10:64px;

  /* Radius */
  --radius-xs: 5px; --radius-sm: 5px; --radius-md: 12px; --radius-lg: 16px;
  --radius-pill: 999px;

  /* Motion */
  --dur-fast: 120ms; --dur: 200ms;
  --dur-slow: 360ms;
  --ease-out: cubic-bezier(0.22,0.78,0.24,1);

  /* Layout */
  --container-chat: 800px; --sidebar-w: 340px;
}
/* Dark-only tokens will be injected by the :root section below */
`

// ========== 撰寫 CSS (無 SCSS，直接在 dist/ 產出純 CSS) ==========

const darkMode = `
[data-theme="dark"] {
  color-scheme: dark;

  /* Dark-only surfaces */
  --surface-0: #04152a; --surface-1: #082038;
  --surface-2: #0e2a47; --surface-3: #16365a;
  --border: #1c3a5e;
  --text: #e9f1fa;
  --text-muted: #9db3ca;
  --text-faint: #647e99;

  /* Blue identity (dark) */
  --blue-ink: #d6ebf8;
  --blue: #34abe2;
  --blue-strong: #209dd7;
  --blue-soft: rgba(40,168,224,0.14);

  /* Yellow (the spark) */
  --yellow-ink: #f6cf63;
  --yellow: #f2b822;
  --yellow-strong: #ecad0a;
  --focus-ring: rgba(242,184,34,0.55);

  /* Role colors (dark) */
  --role-visitor: #209dd7;
  --role-avatar: #3bb6c9;
  --role-human: #ecad0a;

  /* Globs for special bubbles */
  --glow-blue: 0 0 0 1px var(--blue-line), 0 8px 28px -10px rgba(40,168,224,0.35);
  --glow-yellow: 0 0 0 1px var(--yellow-line), 0 8px 30px -10px rgba(236,173,10,0.30);

  /* HUD grid line for dark */
  --grid-line: rgba(120,180,220,0.045);
}`

const lightMode = `
[data-theme="light"] {
  color-scheme: light;
  --surface-0: #f3f6fb;
  --surface-1: #ffffff;
  --surface-2: #eef3f9;
  --surface-sunken: #eaf0f7;
  --border: #d9e2ed;
  --text: #0b2138;
  --text-muted: #4c6076;
  --text-faint: #7d92a6;

  /* Blue identity (light) */
  --blue-ink: #136491;
  --blue: #1487c1;
  --blue-strong: #209dd7;
  --blue-soft: rgba(32,157,215,0.10);
  --blue-line: rgba(32,157,215,0.35);

  /* Yellow (light) */
  --yellow: #ecad0a;
  --yellow-strong: #d39c07;
  --yellow-ink: #8a6404;
  --focus-ring: rgba(236,173,10,0.6);

  /* Role colors (light) */
  --role-visitor: #209dd7;
  --role-avatar: #1b95a6;
  --role-human: #d39c07;
  --glow-blue: 0 0 0 1px var(--blue-line), 0 10px 30px -12px rgba(32,157,215,0.30);
  --glow-yellow: 0 0 0 1px var(--yellow-line), 0 10px 30px -12px rgba(236,173,10,0.28);

  /* HUD grid line for light */
  --grid-line: rgba(3,33,71,0.035);
}`

const defaultTokenValues = `/* ========== Default (dark mode) values for :only-children (visitors) bubble ========== */
--token-token-bg: var(--surface-2);               /* visitor bubble bg  */
--token-token-color: #fff;                              ---
--token-visitor-initials-bg: #1e5a8e;              -- token color */
--token-avatar-ring: #3bb6c9;
--token-human-glow: var(--glow-yellow);              -- ring color */
`

const componentsCSS = fs.readFileSync(path.join(SOURCE,'components.css'), 'utf-8')
  .replace(/--\w+-\w+: \S+;/g, // 保留 brand tokens 被預設值替代
    (m: string) => {
      const raw = m.toLowerCase()
      if (raw.includes('--brand-')) return '/' + m + '/'
      // brand 是變數，直接用 default-token 去覆蓋
      return defaultTokenValues
    })
  .split('/* ========== Default')
  .slice(1)
  .join('')

const full = `
/* =========================================================================== */
/* AVATAR — Frontend Styles (vanilla TS, no framework)                          */
/* =========================================================================== */

${componentsCSS}

/* Dark: default; light: [data-theme="light"] on <html> or <body>            */
html { scroll-behavior: smooth; overflow-x: hidden; }
body { margin: 0; background: dark, dark, dark, dark; background: #032147; }

/* 僅訪問者氣泡覆蓋為 token 值 (dark mode 預設) */
[data-theme="light"] :only-child .bubble {
  --token-token-bg: var(--surface-1);            /* light bubble */
  --token-token-color: var(--text);              /* dark text */
  --token-visitor-initials-bg: #dcedf3;           -- token value */
}
`

// ========== 輸出 ==========
fs.writeFileSync(path.join(OUTPUT,'tokens.css'),tokensRoot)
fs.writeFileSync(path.join(OUTPUT,'components.css'),componentsCSS)
console.log('CSS 生成完成 → frontend/dist/tokens.css, frontend/dist/components.css')
/* export default App */
