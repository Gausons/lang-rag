# Agentic Hybrid Graph RAG (TypeScript Monorepo)

## Stack
- API: Fastify + LangGraph.js (`apps/api`)
- Web: Next.js (`apps/web`)
- Dense retrieval: Qdrant
- Sparse retrieval: local lexical index over chunk store
- Graph retrieval: Neo4j
- Cache: Redis (exact + semantic)
- Multi-turn context: Redis session memory (`sessionId`)
- LLM: OpenAI-compatible via `.env`

## Monorepo Layout
- `apps/api`
- `apps/web`
- `packages/shared`

## Quick Start
1. `cp .env.example .env` and fill OpenAI-compatible credentials.
2. `docker compose up -d`
3. `pnpm install`
4. `pnpm dev`

## API Endpoints
- `POST /ingest` (`multipart file` or JSON `{ "sourcePath": "..." }`)
- `POST /query` (`{ question, topK?, filters?, sessionId? }`)
- `POST /query/stream` (SSE streaming)
- `POST /graph/rebuild`
- `GET /graph/rebuild/:jobId`
- `GET /graph/metrics`
- `GET /health`
- `GET /readyz`
- `GET /livez`
- `GET /metrics`
- `GET /ops/jobs`
- `POST /ops/jobs/:id/retry`

## Ingest Demo
```bash
curl -X POST http://localhost:3001/ingest \
  -H 'content-type: application/json' \
  -d '{"sourcePath":"apps/api/demo-docs"}'
```

## Query Demo
```bash
curl -X POST http://localhost:3001/query \
  -H 'content-type: application/json' \
  -d '{"question":"系统上线依赖了哪些组件？"}'
```

## Eval
```bash
cd apps/api
pnpm eval
cat eval-result.json
```

Output includes:
- `success`
- `latency`
- `citations`
- `ruleScore`
- `hitAtK`
- `recallAtK`
- `categoryBreakdown`

## Tests
```bash
pnpm test
```

## Notes
- Retrieval strategy follows: `dense + sparse + graph -> RRF -> embedding-MMR -> cross-encoder`.
- When `sessionId` is provided, API stores/replays recent turns (default 6) to support multi-turn context.
- Query includes intent recognition: small-talk goes direct response (no retrieval), knowledge questions go full RAG pipeline.
- Recall pool defaults `60~120`, final context defaults `6~12`.
- Job status persistence uses local file storage in `DATA_DIR` (MVP production baseline, easy to swap to SQLite).
