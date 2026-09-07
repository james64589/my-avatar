// Cloudflare Worker type definitions for basic compatibility
type ExportedHandler<T = unknown> = {
  fetch: (request: Request, env: T, ctx: { waitUntil: (promise: Promise<any>) => void }) => Response | Promise<Response>;
};

const ipLastSeenAt = new Map<string, number>();
const keyCooldowns = new Map<string, number>();

export default {
  async fetch(
    request: Request,
    env: {
      CHATANYWHERE_API_KEY?: string;
      CHATANYWHERE_API_KEYS?: string;
      CHATANYWHERE_BASE_URL?: string;
      CHATANYWHERE_MODEL?: string;
      ALLOWED_ORIGINS?: string[];
    }
  ) {
    const url = new URL(request.url);

    const allowedOrigins = new Set(
      Array.isArray(env.ALLOWED_ORIGINS) && env.ALLOWED_ORIGINS.length > 0
        ? env.ALLOWED_ORIGINS
        : ['https://james64589.github.io', 'http://localhost:5173']
    );

    const origin = request.headers.get('Origin') ?? '';
    if (origin && !allowedOrigins.has(origin)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    if (request.method !== 'POST' || url.pathname !== '/api/chat') {
      return new Response('Not Found', { status: 404 });
    }

    const ip =
      request.headers.get('CF-Connecting-IP') ??
      request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
      '';
    if (ip) {
      const now = Date.now();
      const last = ipLastSeenAt.get(ip) ?? 0;
      const minIntervalMs = 3000;
      if (now - last < minIntervalMs) {
        const retryAfter = Math.ceil((minIntervalMs - (now - last)) / 1000);
        const isChinese = request.headers.get('Accept-Language')?.includes('zh');
        const errorMsg = isChinese
          ? '目前請求太頻繁，請稍後再試。'
          : 'Too many requests. Please try again shortly.';
        return new Response(JSON.stringify({ message: { content: errorMsg }, upstreamStatus: 429, retryAfter }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
            ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
          }
        });
      }
      ipLastSeenAt.set(ip, now);
      if (ipLastSeenAt.size > 5000) {
        const entries = Array.from(ipLastSeenAt.entries());
        entries.sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < 1000; i++) ipLastSeenAt.delete(entries[i][0]);
      }
    }

    const body = await request.json().catch(() => null) as null | { messages?: Array<{ role: string; content: string }> };
    const messages = body?.messages ?? [];

    const system = messages.find(m => m.role === 'system')?.content ?? '';
    const chat = messages.filter(m => m.role !== 'system');

    const upstreamMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (system) upstreamMessages.push({ role: 'system', content: system });
    for (const m of chat) {
      const role: 'user' | 'assistant' =
        m.role === 'assistant' || m.role === 'model' || m.role === 'avatar' ? 'assistant' : 'user';
      upstreamMessages.push({ role, content: m.content ?? '' });
    }

    const singleKey = (env.CHATANYWHERE_API_KEY ?? '').trim().replace(/^['"`]|['"`]$/g, '');
    const keyListRaw = (env.CHATANYWHERE_API_KEYS ?? '').trim();
    const apiKeys: string[] = [];

    if (keyListRaw) {
      try {
        const parsed = JSON.parse(keyListRaw);
        if (Array.isArray(parsed)) {
          for (const k of parsed) {
            if (typeof k === 'string' && k.trim()) apiKeys.push(k.trim().replace(/^['"`]|['"`]$/g, ''));
          }
        }
      } catch {
        for (const k of keyListRaw.split(',')) {
          const t = k.trim().replace(/^['"`]|['"`]$/g, '');
          if (t) apiKeys.push(t);
        }
      }
    }

    if (singleKey) apiKeys.unshift(singleKey);

    let uniqueKeys = Array.from(new Set(apiKeys)).filter(Boolean);
    if (uniqueKeys.length === 0) {
      return new Response('Missing CHATANYWHERE_API_KEY', { status: 500 });
    }

    uniqueKeys = uniqueKeys.sort(() => Math.random() - 0.5);

    const baseUrl = (env.CHATANYWHERE_BASE_URL ?? 'https://api.chatanywhere.org').trim().replace(/\/+$/g, '');
    const model = (env.CHATANYWHERE_MODEL ?? 'gpt-4o-mini').trim();
    const payload = JSON.stringify({ model, messages: upstreamMessages, stream: false });

    const upstreamUrl = `${baseUrl}/v1/chat/completions`;
    let upstream: Response | undefined;
    let lastErrText: string | undefined;
    const now = Date.now();

    for (const apiKey of uniqueKeys) {
      const cooldownUntil = keyCooldowns.get(apiKey) ?? 0;
      if (now < cooldownUntil) continue;

      const upstreamInit: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: payload
      };

      for (let attempt = 0; attempt < 3; attempt++) {
        upstream = await fetch(upstreamUrl, upstreamInit);
        if (upstream.ok) {
          keyCooldowns.delete(apiKey);
          break;
        }

        lastErrText = await upstream.text().catch(() => '');

        if (upstream.status === 401) {
          keyCooldowns.set(apiKey, now + 86400000);
          break;
        }

        if (upstream.status === 429) {
          keyCooldowns.set(apiKey, now + 60000);
          break;
        }

        if (upstream.status !== 503) {
          break;
        }

        await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 300 : attempt === 1 ? 900 : 1800));
      }

      if (upstream?.ok) break;
    }

    if (!upstream) {
      const isChinese = request.headers.get('Accept-Language')?.includes('zh');
      const errorMsg = isChinese 
        ? "所有 AI 服務通道目前皆在冷卻中，請稍候 30-60 秒再試。"
        : "All AI service channels are currently cooling down. Please wait 30-60 seconds and try again.";
      
      return new Response(JSON.stringify({ message: { content: errorMsg }, upstreamStatus: 429 }), { 
        status: 429, 
        headers: { 
          'Content-Type': 'application/json',
          ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
        } 
      });
    }

    if (!upstream.ok) {
      const errText = lastErrText ?? (await upstream.text().catch(() => ''));
      const retryAfter = upstream.headers.get('Retry-After');

      const isChinese = request.headers.get('Accept-Language')?.includes('zh');
      let errorMsg: string;
      if (upstream.status === 401) {
        errorMsg = isChinese
          ? '上游拒絕授權（可能是 ChatAnywhere API Key 無效或未啟用）。'
          : 'Upstream authorization failed (ChatAnywhere API key may be invalid or disabled).';
      } else if (upstream.status === 403) {
        errorMsg = isChinese
          ? '上游拒絕請求（可能是餘額不足、權限不足或風控限制）。'
          : 'Upstream rejected the request (insufficient balance/permission or risk control).';
      } else if (upstream.status === 404) {
        errorMsg = isChinese
          ? '上游端點不存在（請確認 CHATANYWHERE_BASE_URL 是否正確）。'
          : 'Upstream endpoint not found (please check CHATANYWHERE_BASE_URL).';
      } else if (upstream.status === 429) {
        errorMsg = isChinese
          ? '目前請求太頻繁，請稍後再試。 若持續出現，通常代表 API 配額或速率已達上限。'
          : 'Too many requests. Please try again shortly. If it keeps happening, you may have hit the API quota/rate limit.';
      } else if (upstream.status === 503) {
        errorMsg = isChinese
          ? '上游服務目前繁忙，請稍後再試。'
          : 'Upstream service is currently busy. Please try again later.';
      } else {
        errorMsg = isChinese
          ? `上游服務回傳錯誤（${upstream.status}）。`
          : `Upstream returned an error (${upstream.status}).`;
      }

      return new Response(
        JSON.stringify({
          message: { content: errorMsg },
          upstreamStatus: upstream.status,
          upstreamBody: errText || null,
          retryAfter: retryAfter ?? null
        }),
        { status: upstream.status, headers: { 'Content-Type': 'application/json', ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}) } }
      );
    }

    const data = await upstream.json() as any;
    const text =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.delta?.content ??
      '';

    return new Response(JSON.stringify({ message: { content: text } }), {
      headers: {
        'Content-Type': 'application/json',
        ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
      }
    });
  }
} satisfies ExportedHandler<{ CHATANYWHERE_API_KEY?: string }>;
