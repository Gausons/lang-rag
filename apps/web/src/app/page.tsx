'use client';

import { useEffect, useMemo, useState } from 'react';

type Citation = { chunkId: string; source: string; snippet: string };
type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  meta?: string;
  citations?: Citation[];
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

export default function Page() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    const saved = window.localStorage.getItem('rag_session_id');
    if (saved) setSessionId(saved);
  }, []);

  useEffect(() => {
    if (sessionId) window.localStorage.setItem('rag_session_id', sessionId);
  }, [sessionId]);

  const canAsk = useMemo(() => !!question.trim() && !loading, [question, loading]);

  function newSession() {
    setSessionId('');
    setMessages([]);
    setErr('');
    window.localStorage.removeItem('rag_session_id');
  }

  function appendToken(targetId: string, token: string) {
    setMessages((prev) =>
      prev.map((m) => (m.id === targetId ? { ...m, content: `${m.content}${token}` } : m))
    );
  }

  function patchAssistant(targetId: string, patch: Partial<Message>) {
    setMessages((prev) => prev.map((m) => (m.id === targetId ? { ...m, ...patch } : m)));
  }

  async function ask() {
    const q = question.trim();
    if (!q || loading) return;
    setErr('');
    setLoading(true);
    setQuestion('');

    const userId = `u_${Date.now()}`;
    const assistantId = `a_${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', content: q },
      { id: assistantId, role: 'assistant', content: '' }
    ]);

    try {
      const requestPayload = { question: q, sessionId: sessionId || undefined };
      let citations: Citation[] = [];
      let meta = '';
      let streamed = false;

      try {
        const r = await fetch(`${API_BASE}/query/stream`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(requestPayload)
        });

        if (!r.ok || !r.body) throw new Error(`stream request failed (${r.status})`);

        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let eventName = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';

          for (const chunk of chunks) {
            const lines = chunk.split('\n');
            let dataStr = '';
            eventName = '';
            for (const line of lines) {
              if (line.startsWith('event:')) eventName = line.replace('event:', '').trim();
              if (line.startsWith('data:')) dataStr += line.replace('data:', '').trim();
            }
            if (!eventName || !dataStr) continue;
            const data = JSON.parse(dataStr) as Record<string, unknown>;

            if (eventName === 'token') {
              streamed = true;
              appendToken(assistantId, String(data.token ?? ''));
            } else if (eventName === 'citations') {
              citations = (data.citations ?? []) as Citation[];
            } else if (eventName === 'done') {
              const sid = String(data.sessionId ?? '');
              if (sid) setSessionId(sid);
              meta = `trace: ${String(data.traceId ?? '')} | cache: ${String(data.cacheHit ?? '')} | ${String(
                data.latencyMs ?? ''
              )}ms`;
            } else if (eventName === 'error') {
              throw new Error(String(data.message ?? 'stream error'));
            }
          }
        }
      } catch {
        const r = await fetch(`${API_BASE}/query`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(requestPayload)
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error?.message ?? 'query failed');
        patchAssistant(assistantId, { content: String(data.answer ?? '') });
        streamed = true;
        citations = (data.citations ?? []) as Citation[];
        meta = `trace: ${String(data.traceId ?? '')} | cache: ${String(data.cacheHit ?? '')} | ${String(
          data.latencyMs ?? ''
        )}ms`;
        const sid = String(data.sessionId ?? '');
        if (sid) setSessionId(sid);
      }

      if (!streamed) patchAssistant(assistantId, { content: '（空响应）' });
      patchAssistant(assistantId, { citations, meta });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
      patchAssistant(assistantId, { content: '流式请求失败，请重试。' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="chat-shell">
      <aside className="chat-side">
        <h2>Enterprise RAG</h2>
        <p>Hybrid Graph RAG</p>
        <button onClick={newSession}>+ New chat</button>
        {sessionId ? <small>session: {sessionId}</small> : <small>session: not started</small>}
      </aside>

      <section className="chat-main">
        <div className="chat-log">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <h1>有什么可以帮你？</h1>
              <p>试试：这个系统上线依赖哪些组件？</p>
            </div>
          ) : (
            messages.map((m) => (
              <article key={m.id} className={`msg ${m.role}`}>
                <div className="msg-avatar">{m.role === 'user' ? '你' : 'AI'}</div>
                <div className="msg-body">
                  <p>{m.content || (loading && m.role === 'assistant' ? '...' : '')}</p>
                  {m.meta ? <p className="msg-meta">{m.meta}</p> : null}
                  {m.citations?.length ? (
                    <ul className="msg-cites">
                      {m.citations.map((c) => (
                        <li key={`${m.id}_${c.chunkId}`}>
                          <code>{c.chunkId}</code> {c.source}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>

        <div className="chat-input">
          <textarea
            rows={3}
            value={question}
            placeholder="给 Agentic Hybrid Graph RAG 发送消息"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask();
              }
            }}
          />
          <div className="chat-actions">
            <button disabled={!canAsk} onClick={ask}>
              {loading ? '生成中...' : '发送'}
            </button>
            {err ? <span className="chat-error">{err}</span> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
