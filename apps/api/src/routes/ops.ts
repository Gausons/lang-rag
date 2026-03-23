import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';
import { allJobs, retryJob } from '../services/jobs.js';

export async function registerOpsRoutes(app: FastifyInstance) {
  app.get('/ops/jobs', async () => {
    const jobs = await allJobs();
    return { jobs };
  });

  app.post('/ops/jobs/:id/retry', async (req) => {
    const { id } = req.params as { id: string };
    const job = await retryJob(id);
    if (!job) throw new AppError('NOT_FOUND', 'job not found', 404);
    return { ok: true, job };
  });
}
