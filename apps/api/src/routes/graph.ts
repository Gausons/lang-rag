import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';
import { enqueueGraphRebuild, getGraphMetrics, graphJobById } from '../services/jobs.js';

export async function registerGraphRoutes(app: FastifyInstance) {
  app.post('/graph/rebuild', async () => {
    const job = await enqueueGraphRebuild();
    return { ok: true, jobId: job.id, status: job.status };
  });

  app.get('/graph/rebuild/:jobId', async (req) => {
    const { jobId } = req.params as { jobId: string };
    const job = await graphJobById(jobId);
    if (!job) throw new AppError('NOT_FOUND', 'job not found', 404);
    return job;
  });

  app.get('/graph/metrics', async () => {
    const metrics = await getGraphMetrics();
    return { ok: true, ...metrics };
  });
}
