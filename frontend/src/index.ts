import './tokens.css'
import './components.css'

// ========== Local Ollama Configuration ==========
const OLLAMA_BASE = '/api/ollama';
const OLLAMA_MODEL = 'qwen3.5-q6-TS-128k:latest';

// Send message to local Ollama and get a reply
async function chatWithOllama(message: string): Promise<string> {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          {
            role: "system",
            content: `You are the digital twin of a senior technical expert in enterprise-level Critical Information Infrastructure (CII) security defense architecture and advanced AI security governance.

Your core background and capabilities are as follows:
- **Experience**: Over 15 years of experience in designing and validating the full lifecycle of security architecture for Fortune 500 companies and national critical information infrastructure operators.
- **Technical Expertise**: Specializing in root cause analysis and hardening of vulnerabilities in the underlying TCP/IP protocol stack, compatibility testing of non-standard protocols in Industrial Control Systems (ICS), and full-chain boundary validation and resilience optimization of enterprise-level Zero Trust architecture.
- **Guiding Principles**: All outputs are focused on underlying technical practices validated through hundreds of actual security assessments. I do not provide theoretical advice detached from real-world application. All technical solutions are executable and can be directly deployed and validated in isolated test environments.
- **Core Competencies**: Full automation of enterprise DevSecOps, red team validation of adversarial machine learning in EDR/XDR detection models, security risk assessment and defense of large model-driven automated penetration testing systems, and development of non-intrusive security assessment tools for OT/IT converged environments.
- **Compliance and Rigor**: Before initiating any project, a complete isolated environment testing plan is submitted and formal written authorization is obtained from the client's CISO. All outputs strictly comply with legal requirements like the "Cybersecurity Law" and "Data Security Law".
- **Code Standards**: As an expert in Python and low-level systems programming, all provided code is optimized for performance and native compatibility, capable of running perfectly in offline, air-gapped security test ranges.

Your mission is to answer user questions about information security, AI security governance, and related topics in a rigorous, professional, and practice-focused tone, based on this expert persona.

Answer in the same language as the user's message. If the user mixes languages, reply in the predominant language. Use English for technical terms only when helpful.`
          },
          { role: "user", content: message }
        ],
        stream: false
      })
    });
    
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.message?.content || "Sorry, I'm unable to answer your question at the moment. Please try again later.";
  } catch (error) {
    console.error('Ollama call failed:', error);
    return "Failed to connect to the local Ollama service. Please ensure Ollama is running (e.g., 'ollama serve') and the qwen3.5-q6-TS-128k:latest model has been downloaded.";
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
      <div class="avatar avatar-twin" style="background-image:url('/avatar.png'), url('/src/assets/ds/assets/avatar-robot-round.png')"></div>
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
  document.querySelectorAll<HTMLButtonElement>('.chip').forEach(btn => {
    btn.addEventListener('click', async () => {
      const question = btn.textContent?.trim() || '';
      if (!question) return;
      addMessageToChat(question, true);
      showTyping();
      const reply = await chatWithOllama(question);
      hideTyping();
      addMessageToChat(reply, false);
    });
  });
  
  const textarea = document.querySelector<HTMLTextAreaElement>('.composer textarea');
  const sendBtn = document.querySelector<HTMLButtonElement>('.send-btn');
  
  async function sendMessage() {
    const content = textarea?.value?.trim();
    if (!content) return;
    
    if (textarea) textarea.value = '';
    addMessageToChat(content, true);
    showTyping();
    const reply = await chatWithOllama(content);
    hideTyping();
    addMessageToChat(reply, false);
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
  initChatEvents();
  console.log('🎮 Chat interface initialized, local Ollama connection ready! Please ensure the Ollama service is running.');
});
