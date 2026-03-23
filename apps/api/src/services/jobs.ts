import { nowIso } from '@lang-rag/shared';
import { extractFacts } from './llm.js';
import { loadChunks, getJob, listJobs, saveJob } from './store.js';
import { writeFacts, graphMetrics } from './graph.js';
import type { GraphBuildJob } from '../types/index.js';

export async function enqueueGraphRebuild() {
  const id = `job_${Date.now()}`;
  const job: GraphBuildJob = {
    id,
    status: 'queued',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    processedChunks: 0
  };
  await saveJob(job);
  void runGraphRebuild(id);
  return job;
}

export async function runGraphRebuild(jobId: string) {
  const existing = await getJob(jobId);
  if (!existing) return;
  await saveJob({ ...existing, status: 'running' });
  try {
    const chunks = await loadChunks();
    let processed = 0;
    for (const chunk of chunks) {
      const extracted = await extractFacts(chunk.text);
      await writeFacts(chunk.metadata.docId, chunk.chunkId, extracted.facts ?? []);
      processed += 1;
      if (processed % 20 === 0) {
        await saveJob({
          ...existing,
          id: jobId,
          status: 'running',
          processedChunks: processed,
          updatedAt: nowIso()
        });
      }
    }
    await saveJob({
      ...existing,
      id: jobId,
      status: 'success',
      processedChunks: processed,
      updatedAt: nowIso()
    });
  } catch (e) {
    await saveJob({
      ...existing,
      id: jobId,
      status: 'failed',
      error: String(e),
      updatedAt: nowIso()
    });
  }
}

export async function graphJobById(id: string) {
  return getJob(id);
}

export async function allJobs() {
  return listJobs();
}

export async function retryJob(id: string) {
  const job = await getJob(id);
  if (!job) return null;
  await saveJob({ ...job, status: 'queued', error: undefined });
  void runGraphRebuild(id);
  return getJob(id);
}

export async function getGraphMetrics() {
  return graphMetrics();
}
