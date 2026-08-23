import './tokens.css'
import './components.css'

// ========== Dual Environment Auto-Switching Configuration ==========
const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const CLOUDFLARE_WORKER_URL = 'https://avatar-chat-proxy.ljl-joe925.workers.dev';
const API_BASE_URL = isLocalDev ? '/api/ollama' : CLOUDFLARE_WORKER_URL;
const OLLAMA_MODEL = 'qwen3.5-q6-TS-128k:latest';
const USER_AVATAR_URLS = [`${import.meta.env.BASE_URL}avatar.png`, '/avatar.png'];
const ROBOT_AVATAR_URL = new URL('./assets/ds/assets/avatar-robot-round.png', import.meta.url).toString();
const NAME_MAX_GRAPHEMES = 5;
// 請求鎖：防止用戶重複提交請求
let isRequestPending = false;

type ChatHistoryItem = {
  role: 'visitor' | 'avatar';
  content: string;
  ts: number;
};

const STORAGE_KEYS = {
  keepChat: 'avatar_keep_chat',
  chatHistory: 'avatar_chat_history_v1',
  userName: 'avatar_user_name',
  theme: 'avatar_theme',
} as const;

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function storageRemove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

function getUserName(): string {
  const input = document.getElementById('userName') as HTMLInputElement | null;
  const current = input?.value?.trim();
  if (current) return current;
  const saved = storageGet(STORAGE_KEYS.userName)?.trim();
  return saved || 'You';
}

function splitGraphemes(text: string): string[] {
  if (!text) return [];
  const Segmenter = (Intl as any)?.Segmenter as undefined | (new (locales?: string | string[], options?: any) => any);
  if (Segmenter) {
    const segmenter = new Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (s: any) => s.segment);
  }
  return Array.from(text);
}

function sliceGraphemes(text: string, maxGraphemes: number): string {
  return splitGraphemes(text).slice(0, maxGraphemes).join('');
}

type UiLang = 'zh' | 'ja' | 'ko' | 'ru' | 'fr' | 'en';

function detectUiLang(text: string): UiLang {
  const t = text || '';
  if (/[\uAC00-\uD7AF]/.test(t)) return 'ko';
  if (/[\u3040-\u30FF]/.test(t)) return 'ja';
  if (/[\u4E00-\u9FFF]/.test(t)) return 'zh';
  if (/[\u0400-\u04FF]/.test(t)) return 'ru';
  const nav = (navigator.languages?.[0] || navigator.language || '').toLowerCase();
  if (nav.startsWith('fr')) return 'fr';
  return 'en';
}

function uiText(lang: UiLang, key: 'rate_limited' | 'busy' | 'quota' | 'connect_failed' | 'request_pending'): string {
  const dict: Record<UiLang, Record<string, string>> = {
    zh: {
      rate_limited: '目前請求太頻繁，請稍後再試。',
      busy: 'Gemini 目前流量較高，請稍後再試（通常再送一次就會好）。',
      quota: '若持續出現，通常代表 API 配額或速率已達上限。',
      connect_failed: '目前無法連線到 AI 服務，請稍後再試。',
      request_pending: '正在處理您的請求，請勿重複發送消息...',
    },
    ja: {
      rate_limited: 'リクエストが多すぎます。しばらくしてから再試行してください。',
      busy: 'Gemini が混雑しています。少し待ってから再試行してください（もう一度送ると通ることが多いです）。',
      quota: '繰り返し発生する場合、API の上限（クォータ/レート制限）に達している可能性があります。',
      connect_failed: 'AI サービスに接続できません。しばらくしてから再試行してください。',
      request_pending: 'リクエストを処理中です。重複して送信しないでください...',
    },
    ko: {
      rate_limited: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
      busy: 'Gemini 가 혼잡합니다. 잠시 후 다시 시도해 주세요(보통 한 번 더 보내면 됩니다).',
      quota: '계속 발생하면 API 할당량/속도 제한에 도달했을 수 있습니다.',
      connect_failed: 'AI 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      request_pending: '요청을 처리 중입니다. 중복으로 보내지 마세요...',
    },
    ru: {
      rate_limited: 'Слишком много запросов. Пожалуйста, попробуйте позже.',
      busy: 'Gemini сейчас перегружен. Пожалуйста, попробуйте позже (часто помогает отправить ещё раз).',
      quota: 'Если повторяется, возможно, достигнут лимит квоты/скорости API.',
      connect_failed: 'Не удалось подключиться к AI‑сервису. Пожалуйста, попробуйте позже.',
      request_pending: 'Запрос обрабатывается. Пожалуйста, не отправляйте повторно...',
    },
    fr: {
      rate_limited: 'Trop de requêtes. Veuillez réessayer plus tard.',
      busy: 'Gemini est momentanément saturé. Réessayez dans un instant (souvent, un second envoi passe).',
      quota: 'Si cela persiste, vous avez probablement atteint le quota/la limite de débit de l’API.',
      connect_failed: 'Impossible de se connecter au service IA. Veuillez réessayer plus tard.',
      request_pending: 'Votre demande est en cours de traitement. Veuillez ne pas renvoyer le message...',
    },
    en: {
      rate_limited: 'Too many requests. Please try again shortly.',
      busy: 'Gemini is currently busy. Please try again shortly (often a second send works).',
      quota: 'If it keeps happening, you may have hit the API quota/rate limit.',
      connect_failed: 'Failed to connect to the AI service. Please try again later.',
      request_pending: 'Your request is being processed. Please do not send messages repeatedly...',
    },
  };

  return dict[lang][key] || dict.en[key];
}

function setUserName(name: string) {
  const normalized = name.replace(/\s+/g, ' ').trim();
  const trimmed = sliceGraphemes(normalized, NAME_MAX_GRAPHEMES);
  const input = document.getElementById('userName') as HTMLInputElement | null;
  if (input) input.value = trimmed || 'You';
  storageSet(STORAGE_KEYS.userName, trimmed || 'You');

  const label = getUserDisplayName();
  document.querySelectorAll<HTMLElement>('.msg--visitor .avatar-initials').forEach(el => {
    el.textContent = label;
    el.setAttribute('title', label);
  });
  document.querySelectorAll<HTMLElement>('.msg--visitor .msg-name').forEach(el => {
    el.textContent = label;
  });
}

function getUserDisplayName(): string {
  return getUserName();
}

function isKeepChatEnabled(): boolean {
  const checkbox = document.getElementById('keepChat') as HTMLInputElement | null;
  if (checkbox) return checkbox.checked;
  const saved = storageGet(STORAGE_KEYS.keepChat);
  if (saved === null) return true;
  return saved === '1';
}

function setKeepChatEnabled(enabled: boolean) {
  const checkbox = document.getElementById('keepChat') as HTMLInputElement | null;
  if (checkbox) checkbox.checked = enabled;
  storageSet(STORAGE_KEYS.keepChat, enabled ? '1' : '0');
  if (!enabled) storageRemove(STORAGE_KEYS.chatHistory);
}

function loadChatHistory(): ChatHistoryItem[] {
  const raw = storageGet(STORAGE_KEYS.chatHistory);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ChatHistoryItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(m => m && (m.role === 'visitor' || m.role === 'avatar') && typeof m.content === 'string' && typeof m.ts === 'number');
  } catch {
    return [];
  }
}

function saveChatHistory(history: ChatHistoryItem[]) {
  const capped = history.slice(-100);
  storageSet(STORAGE_KEYS.chatHistory, JSON.stringify(capped));
}

function clearChatHistory() {
  storageRemove(STORAGE_KEYS.chatHistory);
}

function getTheme(): 'dark' | 'light' {
  const saved = storageGet(STORAGE_KEYS.theme);
  if (saved === 'dark' || saved === 'light') return saved;
  const current = document.documentElement.getAttribute('data-theme');
  return current === 'light' ? 'light' : 'dark';
}

function setTheme(theme: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', theme);
  storageSet(STORAGE_KEYS.theme, theme);
}

function getAvatarBackgroundImage(): string {
  const urls = [...USER_AVATAR_URLS, ROBOT_AVATAR_URL];
  return urls.map(u => `url('${u}')`).join(', ');
}

// Send message to AI service (auto-switch between local Ollama and Cloudflare Worker)
async function chatWithOllama(message: string): Promise<string> {
  // 如果已經有請求在處理中，直接返回錯誤
  if (isRequestPending) {
    const lang = detectUiLang(message);
    return uiText(lang, 'request_pending');
  }
  
  try {
    isRequestPending = true; // 獲取鎖
    let apiUrl: string;
    let requestBody: any;
    const lang = detectUiLang(message);
    
    const systemContent = `你是資安與 AI 安全治理領域的資深顧問（偏實務、可落地）。請用使用者訊息的主要語言回覆（例如：日文→日文、法文→法文、英文→英文、繁中→繁中）。若使用者混用語言，請用主要語言回覆，必要時保留少量英文技術名詞。資訊不足時先反問澄清。`;

    if (isLocalDev) {
      // Local development: use Ollama API
      apiUrl = `${API_BASE_URL}/api/chat`;
      requestBody = {
        model: OLLAMA_MODEL,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: message }
        ],
        stream: false
      };
    } else {
      // Production: use Cloudflare Worker proxy API
      apiUrl = `${API_BASE_URL}/api/chat`;
      requestBody = {
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: message }
        ]
      };
    }
    
    console.log(`[${isLocalDev ? 'Local' : 'Remote'}] Sending request`);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      let details: any = null;
      try {
        details = await response.json();
      } catch {
        details = null;
      }
      if (!isLocalDev && details?.upstreamStatus === 503) {
        return uiText(lang, 'busy');
      }
      if (!isLocalDev && details?.upstreamStatus === 429) {
        return `${uiText(lang, 'rate_limited')} ${uiText(lang, 'quota')}`;
      }
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.message?.content || "Sorry, I'm unable to answer your question at the moment. Please try again later.";
  } catch (error) {
    console.error('API call failed:', error);
    if (isLocalDev) {
      return "Failed to connect to the local Ollama service. Please ensure Ollama is running (e.g., 'ollama serve') and the qwen3.5-q6-TS-128k:latest model has been downloaded.";
    } else {
      const lang = detectUiLang(message);
      return uiText(lang, 'connect_failed');
    }
  } finally {
    isRequestPending = false; // 釋放鎖，確保無論成功失敗都能解鎖
  }
}

// ========== Chat Interaction Logic ==========
function appendMessageToChat(content: string, isVisitor: boolean, opts?: { persist?: boolean; ts?: number }) {
  const convoInner = document.querySelector<HTMLDivElement>('.convo-inner');
  if (!convoInner) return;
  
  const ts = opts?.ts ?? Date.now();
  const now = new Date(ts);
  const hours12 = now.getHours() % 12 || 12;
  const timeStr = `${hours12}:${now.getMinutes().toString().padStart(2, '0')} ${now.getHours() >= 12 ? 'PM' : 'AM'}`;
  
  const messageEl = document.createElement('div');
  messageEl.className = `msg ${isVisitor ? 'msg--visitor' : 'msg--avatar'}`;
  
  const sanitizedContent = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  if (isVisitor) {
    const label = getUserDisplayName();
    const sanitizedLabel = label.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    messageEl.innerHTML = `
      <span class="avatar-initials" title="${sanitizedLabel}">${sanitizedLabel}</span>
      <div class="msg-body">
        <div class="msg-meta"><span class="msg-name">${sanitizedLabel}</span><span class="msg-time">${timeStr}</span></div>
        <div class="bubble"><p>${sanitizedContent}</p></div>
      </div>
    `;
  } else {
    messageEl.innerHTML = `
      <div class="avatar avatar-twin" style="background-image:${getAvatarBackgroundImage()}"></div>
      <div class="msg-body">
        <div class="msg-meta"><span class="msg-name">Avatar</span><span class="msg-time">${timeStr}</span></div>
        <div class="bubble"><p>${sanitizedContent}</p></div>
      </div>
    `;
  }
  
  convoInner.appendChild(messageEl);
  const convo = document.querySelector<HTMLDivElement>('.convo');
  if (convo) convo.scrollTop = convo.scrollHeight;

  if (opts?.persist === false) return;
  if (!isKeepChatEnabled()) return;
  const history = loadChatHistory();
  history.push({ role: isVisitor ? 'visitor' : 'avatar', content, ts });
  saveChatHistory(history);
}

function addMessageToChat(content: string, isVisitor: boolean) {
  appendMessageToChat(content, isVisitor);
}

function showTyping() {
  const convoInner = document.querySelector<HTMLDivElement>('.convo-inner');
  if (!convoInner) return;
  
  if (document.getElementById('typing-indicator')) return; // Already showing

  const typingEl = document.createElement('div');
  typingEl.id = 'typing-indicator';
  typingEl.className = 'typing';
  typingEl.innerHTML = '<span class="dots"><span></span><span></span><span></span></span> Avatar is typing...';
  convoInner.appendChild(typingEl);
  
  const convo = document.querySelector<HTMLDivElement>('.convo');
  if (convo) convo.scrollTop = convo.scrollHeight;
}

function hideTyping() {
  const typingEl = document.getElementById('typing-indicator');
  if (typingEl) typingEl.remove();
}

function initChatEvents() {
  let inFlight = false;
  let lastSentAt = 0;

  async function ask(question: string) {
    const now = Date.now();
    if (inFlight) return;
    
    // 將預設發送間隔增加到 3 秒，以符合 Gemini 免費版的速率限制
    const minInterval = 3000;
    if (now - lastSentAt < minInterval) {
      console.warn('Request throttled by frontend cooldown');
      return;
    }
    
    inFlight = true;
    lastSentAt = now;

    const sendBtn = document.querySelector<HTMLButtonElement>('.send-btn');
    const textarea = document.querySelector<HTMLTextAreaElement>('.composer textarea');
    
    if (sendBtn) sendBtn.disabled = true;
    addMessageToChat(question, true);
    showTyping();
    
    const reply = await chatWithOllama(question);
    hideTyping();
    addMessageToChat(reply, false);
    
    inFlight = false;
    
    // 檢查回覆是否包含「太頻繁」或「配額上限」的關鍵字
    const isRateLimited = reply.includes('太頻繁') || reply.includes('Too many requests') || reply.includes('配額');
    
    if (sendBtn) {
      if (isRateLimited) {
        // 如果遇到 429，強制鎖定按鈕 10 秒，防止使用者連續點擊
        let countdown = 10;
        const originalText = sendBtn.innerHTML;
        sendBtn.disabled = true;
        
        const timer = setInterval(() => {
          countdown--;
          if (countdown <= 0) {
            clearInterval(timer);
            sendBtn.disabled = false;
            sendBtn.innerHTML = originalText;
          } else {
            sendBtn.textContent = `${countdown}s`;
          }
        }, 1000);
      } else {
        sendBtn.disabled = false;
      }
    }
  }

  document.querySelectorAll<HTMLButtonElement>('.chip').forEach(btn => {
    btn.addEventListener('click', async () => {
      const question = btn.textContent?.trim() || '';
      if (!question) return;
      await ask(question);
    });
  });
  
  const textarea = document.querySelector<HTMLTextAreaElement>('.composer textarea');
  const sendBtn = document.querySelector<HTMLButtonElement>('.send-btn');
  
  async function sendMessage() {
    const content = textarea?.value?.trim();
    if (!content) return;
    
    if (textarea) textarea.value = '';
    await ask(content);
  }
  
  sendBtn?.addEventListener('click', sendMessage);
  
  textarea?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

function resetChatUi() {
  hideTyping();
  const convoInner = document.querySelector<HTMLDivElement>('.convo-inner');
  if (!convoInner) return;
  convoInner.querySelectorAll('.msg').forEach(el => el.remove());
}

function restoreChatHistory() {
  if (!isKeepChatEnabled()) return;
  const history = loadChatHistory();
  for (const item of history) {
    appendMessageToChat(item.content, item.role === 'visitor', { persist: false, ts: item.ts });
  }
}

function initTopbar() {
  const userNameInput = document.getElementById('userName') as HTMLInputElement | null;
  const savedName = storageGet(STORAGE_KEYS.userName);
  if (savedName && userNameInput) userNameInput.value = savedName;
  userNameInput?.addEventListener('input', () => setUserName(userNameInput.value));
  userNameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      userNameInput.blur();
    }
  });

  const keepChat = document.getElementById('keepChat') as HTMLInputElement | null;
  const savedKeep = storageGet(STORAGE_KEYS.keepChat);
  if (savedKeep !== null) setKeepChatEnabled(savedKeep === '1');
  keepChat?.addEventListener('change', () => {
    setKeepChatEnabled(!!keepChat.checked);
    if (!keepChat.checked) {
      clearChatHistory();
    } else {
      saveChatHistory(loadChatHistory());
    }
  });

  const resetBtn = document.getElementById('resetChat') as HTMLButtonElement | null;
  resetBtn?.addEventListener('click', () => {
    resetChatUi();
    clearChatHistory();
  });

  const themeToggle = document.getElementById('themeToggle') as HTMLButtonElement | null;
  setTheme(getTheme());
  themeToggle?.addEventListener('click', () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const introAvatar = document.getElementById('introAvatar');
  if (introAvatar) {
    (introAvatar as HTMLDivElement).style.backgroundImage = getAvatarBackgroundImage();
  }
  initTopbar();
  restoreChatHistory();
  initChatEvents();
  console.log(`🎮 Chat interface initialized in ${isLocalDev ? 'LOCAL DEVELOPMENT' : 'PRODUCTION'} mode.`);
  if (isLocalDev) {
    console.log('Please ensure the local Ollama service is running.');
  }
});