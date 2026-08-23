// Cloudflare Worker type definitions for basic compatibility
type ExportedHandler<T = unknown> = {
  fetch: (request: Request, env: T, ctx: { waitUntil: (promise: Promise<any>) => void }) => Response | Promise<Response>;
};

const ipLastSeenAt = new Map<string, number>();
const keyCooldowns = new Map<string, number>(); // 追蹤 API Key 的冷卻時間

export default {
  async fetch(
    request: Request,
    env: { GEMINI_API_KEY?: string; GEMINI_API_KEYS?: string; ALLOWED_ORIGINS?: string[] }
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
      // 基本間隔 3 秒，但如果之前有過度請求，可以考慮動態增加
      const minIntervalMs = 3000;
      if (now - last < minIntervalMs) {
        const retryAfter = Math.ceil((minIntervalMs - (now - last)) / 1000);
        return new Response(JSON.stringify({ error: 'RATE_LIMITED', retryAfter }), {
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

    const contents = chat.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content ?? '' }]
    }));

    const singleKey = (env.GEMINI_API_KEY ?? '').trim().replace(/^['"`]|['"`]$/g, '');
    const keyListRaw = (env.GEMINI_API_KEYS ?? '').trim();
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
      return new Response('Missing GEMINI_API_KEY', { status: 500 });
    }

    // 隨機化 Key 的順序，避免所有請求都先撞第一個 Key
    uniqueKeys = uniqueKeys.sort(() => Math.random() - 0.5);

    const payload = JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents
    });

    const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent`;
    let upstream: Response | undefined;
    let lastErrText: string | undefined;
    const now = Date.now();

    for (const apiKey of uniqueKeys) {
      // 檢查 Key 是否在冷卻中 (60秒內回傳過 429)
      const cooldownUntil = keyCooldowns.get(apiKey) ?? 0;
      if (now < cooldownUntil) continue;

      const upstreamInit: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: payload
      };

      for (let attempt = 0; attempt < 3; attempt++) {
        upstream = await fetch(upstreamUrl, upstreamInit);
        
        if (upstream.ok) {
          // 成功後清除可能存在的冷卻狀態
          keyCooldowns.delete(apiKey);
          break;
        }

        lastErrText = await upstream.text().catch(() => '');

        if (upstream.status === 400 && /API_KEY_INVALID/i.test(lastErrText)) {
          // 無效的 Key 永久冷卻 (直到 Worker 重啟)
          keyCooldowns.set(apiKey, now + 86400000);
          break;
        }

        if (upstream.status === 429) {
          // 遇到 429，將此 Key 冷卻 60 秒
          keyCooldowns.set(apiKey, now + 60000);
          break; // 直接嘗試下一個 Key，不要在同一個 Key 上重試
        }

        if (upstream.status !== 503) {
          break; // 其他錯誤碼不重試
        }

        // 僅針對 503 (服務忙碌) 進行指數退避重試
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
      // 處理Gemini API的速率限制和配額錯誤
      if (upstream.status === 429) {
        const isChinese = request.headers.get('Accept-Language')?.includes('zh');
        const errorMsg = isChinese 
          ? "目前請求太頻繁，請稍後再試。若持續出現，通常代表API配額或速率已達上限。"
          : "Too many requests. Please try again shortly. If it keeps happening, you may have hit the API quota/rate limit.";
        return new Response(JSON.stringify({ message: { content: errorMsg } }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
          }
        });
      }
      const errText = lastErrText ?? (await upstream.text().catch(() => ''));
      const retryAfter = upstream.headers.get('Retry-After');
      return new Response(
        JSON.stringify({ upstreamStatus: upstream.status, upstreamBody: errText || null, retryAfter: retryAfter ?? null }),
        { status: upstream.status, headers: { 'Content-Type': 'application/json', ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}) } }
      );
    }

    const data = await upstream.json() as any;
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ??
      '';

    return new Response(JSON.stringify({ message: { content: text } }), {
      headers: {
        'Content-Type': 'application/json',
        ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
      }
    });
  }
} satisfies ExportedHandler<{ GEMINI_API_KEY: string }>;