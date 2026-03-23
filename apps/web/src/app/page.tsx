'use client';

import { useState } from 'react';

type Resp = {
  answer: string;
  citations: { chunkId: string; source: string; snippet: string }[];
  traceId: string;
  cacheHit: string;
  latencyMs: number;
};

export default function Page() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<Resp | null>(null);
  const [err, setErr] = useState('');

  async function ask() {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001'}/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message ?? 'query failed');
      setResp(data);
    } catch (e) {
      setErr(String(e));
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
          {resp ? (
            <span className="meta">
              trace: {resp.traceId} | cache: {resp.cacheHit} | {resp.latencyMs}ms
            </span>
          ) : null}
        </div>
        {err ? <p style={{ color: '#9f1616' }}>{err}</p> : null}
      </div>
      {resp ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>答案</h3>
          <p>{resp.answer}</p>
          <h3>引用</h3>
          <ul>
            {resp.citations.map((c) => (
              <li key={c.chunkId}>
                <code>{c.chunkId}</code> | {c.source}
                <br />
                {c.snippet}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </main>
  );
}
