import crypto from 'node:crypto';
import { semanticChunk } from '../lib/chunking.js';
import { collectFilesFromPath, parseFile } from './parser.js';
import { upsertDense } from './indexing.js';
import { appendChunks } from './store.js';
import { extractFacts } from './llm.js';
import { writeFacts } from './graph.js';
import { redis } from './clients.js';

export async function ingestFromPath(sourcePath: string) {
  const files = await collectFilesFromPath(sourcePath);
  let chunksTotal = 0;
  let factsWritten = 0;

  for (const file of files) {
    const parsed = await parseFile(file);
    const docId = crypto.createHash('md5').update(file).digest('hex').slice(0, 12);
    const chunks = semanticChunk(parsed.text, {
      docId,
      source: file,
      page: parsed.page,
      section: parsed.section
    });
    await appendChunks(chunks);
    const embMap = await upsertDense(chunks);

    for (const [chunkId, emb] of Object.entries(embMap)) {
      await redis.set(`rag:chunk:emb:${chunkId}`, JSON.stringify(emb));
    }

    for (const chunk of chunks.slice(0, 24)) {
      const extracted = await extractFacts(chunk.text);
      const out = await writeFacts(docId, chunk.chunkId, extracted.facts ?? []);
      factsWritten += out.written;
    }
    chunksTotal += chunks.length;
  }

  return { files: files.length, chunks: chunksTotal, factsWritten };
}
