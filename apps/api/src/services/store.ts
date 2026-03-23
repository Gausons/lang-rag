import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChunkRecord } from '@lang-rag/shared';
import { nowIso } from '@lang-rag/shared';
import { env } from '../lib/config.js';
import type { GraphBuildJob } from '../types/index.js';

const chunksFile = path.join(env.DATA_DIR, 'chunks.jsonl');
const jobsFile = path.join(env.DATA_DIR, 'jobs.json');

async function ensureDataDir() {
  await fs.mkdir(env.DATA_DIR, { recursive: true });
}

export async function appendChunks(chunks: ChunkRecord[]): Promise<void> {
  if (!chunks.length) return;
  await ensureDataDir();
  const lines = chunks.map((c) => JSON.stringify(c)).join('\n') + '\n';
  await fs.appendFile(chunksFile, lines, 'utf-8');
}

export async function loadChunks(): Promise<ChunkRecord[]> {
  try {
    const content = await fs.readFile(chunksFile, 'utf-8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ChunkRecord);
  } catch {
    return [];
  }
}

export async function listJobs(): Promise<GraphBuildJob[]> {
  try {
    return JSON.parse(await fs.readFile(jobsFile, 'utf-8')) as GraphBuildJob[];
  } catch {
    return [];
  }
}

export async function saveJob(job: GraphBuildJob): Promise<void> {
  await ensureDataDir();
  const jobs = await listJobs();
  const idx = jobs.findIndex((j) => j.id === job.id);
  const updated = { ...job, updatedAt: nowIso() };
  if (idx >= 0) jobs[idx] = updated;
  else jobs.unshift(updated);
  await fs.writeFile(jobsFile, JSON.stringify(jobs, null, 2));
}

export async function getJob(id: string): Promise<GraphBuildJob | undefined> {
  const jobs = await listJobs();
  return jobs.find((j) => j.id === id);
}
