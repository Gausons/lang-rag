import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';
import { ingestFromPath } from '../services/ingest.js';

export async function registerIngestRoutes(app: FastifyInstance) {
  app.post('/ingest', async (req) => {
    const contentType = req.headers['content-type'] ?? '';
    let sourcePath: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      const file = await req.file();
      if (!file) throw new AppError('INVALID_INPUT', 'multipart upload missing file', 400);
      const tmpPath = path.join(os.tmpdir(), `${Date.now()}_${file.filename}`);
      await fs.writeFile(tmpPath, await file.toBuffer());
      sourcePath = tmpPath;
    } else {
      const body = (req.body ?? {}) as { sourcePath?: string };
      sourcePath = body.sourcePath;
    }

    if (!sourcePath) throw new AppError('INVALID_INPUT', 'sourcePath or file is required', 400);
    const result = await ingestFromPath(sourcePath);
    return { ok: true, ...result };
  });
}
