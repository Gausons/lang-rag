import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import pdf from 'pdf-parse';
import { AppError } from '../lib/errors.js';

export type ParsedDoc = {
  text: string;
  source: string;
  page?: number;
  section?: string;
};

export async function parseFile(filePath: string): Promise<ParsedDoc> {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = await fs.readFile(filePath);

  if (ext === '.txt' || ext === '.md') {
    return { text: buffer.toString('utf-8'), source: filePath };
  }

  if (ext === '.pdf') {
    const out = await pdf(buffer);
    return { text: out.text, source: filePath };
  }

  if (ext === '.docx') {
    const out = await mammoth.extractRawText({ buffer });
    return { text: out.value, source: filePath };
  }

  throw new AppError('UNSUPPORTED_FILE', `Unsupported file extension: ${ext}`, 400);
}

export async function collectFilesFromPath(sourcePath: string): Promise<string[]> {
  const stat = await fs.stat(sourcePath);
  if (stat.isFile()) return [sourcePath];
  const files: string[] = [];
  const stack = [sourcePath];

  while (stack.length) {
    const cur = stack.pop()!;
    const entries = await fs.readdir(cur, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/\.(pdf|docx|md|txt)$/i.test(entry.name)) {
        files.push(full);
      }
    }
  }

  return files;
}
