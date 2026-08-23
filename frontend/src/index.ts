import './tokens.css'
import './components.css'

// ========== Dual Environment Auto-Switching Configuration ==========
const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const CLOUDFLARE_WORKER_URL = 'https://avatar-chat-proxy.ljl-joe925.workers.dev';
const API_BASE_URL = isLocalDev ? '/api/ollama' : CLOUDFLARE_WORKER_URL;
const OLLAMA_MODEL = 'qwen3.5-q6-TS-128k:latest';
const USER_AVATAR_URLS = [`${import.meta.env.BASE_URL}avatar.png`, '/avatar.png'];
const ROBOT_AVATAR_URL = new URL('./assets/ds/assets/avatar-robot-round.png', import.meta.url).toString();

function getAvatarBackgroundImage(): string {
  const urls = [...USER_AVATAR_URLS, ROBOT_AVATAR_URL];
  return urls.map(u => `url('${u}')`).join(', ');
}

// Send message to AI service (auto-switch between local Ollama and Cloudflare Worker)
async function chatWithOllama(message: string): Promise<string> {
  try {
    let apiUrl: string;
    let requestBody: any;
    
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
        return 'Gemini 目前流量較高，請稍後再試（通常再送一次就會好）。';
      }
      if (!isLocalDev && details?.upstreamStatus === 429) {
        return '目前請求太頻繁，請稍後再試。若持續出現，通常代表 API 配額或速率已達上限。';
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
      return "Failed to connect to the AI service. Please try again later.";
    }
  }
}

// ========== Chat Interaction Logic ==========
function addMessageToChat(content: string, isVisitor: boolean) {
  const convoInner = document.querySelector<HTMLDivElement>('.convo-inner');
  if (!convoInner) return;
  
  const now = new Date();
  const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2,'0')} ${now.getHours() >= 12 ? 'PM' : 'AM'}`;
  
  const messageEl = document.createElement('div');
  messageEl.className = `msg ${isVisitor ? 'msg--visitor' : 'msg--avatar'}`;
  
  const sanitizedContent = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  if (isVisitor) {
    messageEl.innerHTML = `
      <span class="avatar-initials">You</span>
      <div class="msg-body">
        <div class="msg-meta"><span class="msg-time">${timeStr}</span></div>
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
    if (now - lastSentAt < 1500) return;
    inFlight = true;
    lastSentAt = now;

    const sendBtn = document.querySelector<HTMLButtonElement>('.send-btn');
    if (sendBtn) sendBtn.disabled = true;
    addMessageToChat(question, true);
    showTyping();
    const reply = await chatWithOllama(question);
    hideTyping();
    addMessageToChat(reply, false);
    inFlight = false;
    if (sendBtn) sendBtn.disabled = false;
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

document.addEventListener('DOMContentLoaded', () => {
  const introAvatar = document.getElementById('introAvatar');
  if (introAvatar) {
    (introAvatar as HTMLDivElement).style.backgroundImage = getAvatarBackgroundImage();
  }
  initChatEvents();
  console.log(`🎮 Chat interface initialized in ${isLocalDev ? 'LOCAL DEVELOPMENT' : 'PRODUCTION'} mode.`);
  if (isLocalDev) {
    console.log('Please ensure the local Ollama service is running.');
  }
});
