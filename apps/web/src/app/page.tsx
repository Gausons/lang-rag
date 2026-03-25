'use client';

import { useEffect, useState } from 'react';

type Resp = {
  answer: string;
  citations: { chunkId: string; source: string; snippet: string }[];
  traceId: string;
  cacheHit: string;
  latencyMs: number;
  sessionId: string;
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
  meta?: string;
  citations?: Resp['citations'];
};

export default function Page() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [err, setErr] = useState('');

  useEffect(() => {
    const saved = window.localStorage.getItem('rag_session_id');
    if (saved) setSessionId(saved);
  }, []);

  useEffect(() => {
    if (sessionId) window.localStorage.setItem('rag_session_id', sessionId);
  }, [sessionId]);

  function newSession() {
    setSessionId('');
    setMessages([]);
    setErr('');
    window.localStorage.removeItem('rag_session_id');
  }

  async function ask() {
    const q = question.trim();
    if (!q) return;
    setLoading(true);
    setErr('');
    setMessages((prev) => [...prev, { role: 'user', content: q }]);
    setQuestion('');
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001'}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, sessionId: sessionId || undefined })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message ?? 'query failed');
      const resp = data as Resp;
      setSessionId(resp.sessionId);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: resp.answer,
          meta: `trace: ${resp.traceId} | cache: ${resp.cacheHit} | ${resp.latencyMs}ms`,
          citations: resp.citations
        }
      ]);
    } catch (e) {
      setErr(String(e));
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '本轮请求失败，请稍后重试。'
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="wrap">
      <div className="card">
        <h1>Agentic Hybrid Graph RAG</h1>
        <p className="meta">Fastify + LangGraph.js + Qdrant + Neo4j + Redis</p>
        <textarea
          rows={5}
          placeholder="输入问题，例如：某系统上线依赖了哪些组件？"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button disabled={loading || !question.trim()} onClick={ask}>
            {loading ? '查询中...' : '查询'}
          </button>
          <button onClick={newSession}>新会话</button>
          {sessionId ? <span className="meta">session: {sessionId}</span> : null}
        </div>
        {err ? <p style={{ color: '#9f1616' }}>{err}</p> : null}
      </div>
      {messages.length ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>会话</h3>
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 14, paddingBottom: 10, borderBottom: '1px dashed #d8c8ad' }}>
              <p>
                <strong>{m.role === 'user' ? '你' : '助手'}：</strong>
                {m.content}
              </p>
              {m.meta ? <p className="meta">{m.meta}</p> : null}
              {m.citations?.length ? (
                <ul>
                  {m.citations.map((c) => (
                    <li key={`${i}_${c.chunkId}`}>
                      <code>{c.chunkId}</code> | {c.source}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </main>
  );
}
