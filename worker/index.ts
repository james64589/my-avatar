// Cloudflare Worker type definitions for basic compatibility
type ExportedHandler<T = unknown> = {
  fetch: (request: Request, env: T, ctx: { waitUntil: (promise: Promise<any>) => void }) => Response | Promise<Response>;
};

export default {
  async fetch(request: Request, env: { GEMINI_API_KEY?: string; ALLOWED_ORIGINS?: string[] }) {
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

    const body = await request.json().catch(() => null) as null | { messages?: Array<{ role: string; content: string }> };
    const messages = body?.messages ?? [];

    const system = messages.find(m => m.role === 'system')?.content ?? '';
    const chat = messages.filter(m => m.role !== 'system');

    const contents = chat.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content ?? '' }]
    }));

    const apiKey = (env.GEMINI_API_KEY ?? '').trim().replace(/^['"`]|['"`]$/g, '');
    if (!apiKey) {
      return new Response('Missing GEMINI_API_KEY', { status: 500 });
    }

    const payload = JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents
    });

    const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent`;
    const upstreamInit: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: payload
    };

    let upstream: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      upstream = await fetch(upstreamUrl, upstreamInit);
      if (upstream.ok) break;
      if (upstream.status !== 429 && upstream.status !== 503) break;
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 300 : attempt === 1 ? 900 : 1800));
    }

    if (!upstream) {
      return new Response('Upstream unavailable', { status: 502 });
    }

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      return new Response(
        JSON.stringify({ upstreamStatus: upstream.status, upstreamBody: errText || null }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}) } }
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
