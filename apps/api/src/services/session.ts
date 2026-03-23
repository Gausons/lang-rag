import { redis } from './clients.js';

export type SessionTurn = {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
};

function key(sessionId: string) {
  return `rag:session:${sessionId}:turns`;
}

export async function appendSessionTurn(sessionId: string, turn: SessionTurn, maxTurns = 6) {
  const k = key(sessionId);
  await redis.rpush(k, JSON.stringify(turn));
  const maxItems = Math.max(2, maxTurns * 2);
  await redis.ltrim(k, -maxItems, -1);
  await redis.expire(k, 60 * 60 * 24 * 7);
}

export async function getSessionTurns(sessionId: string, maxTurns = 6): Promise<SessionTurn[]> {
  const maxItems = Math.max(2, maxTurns * 2);
  const rows = await redis.lrange(key(sessionId), -maxItems, -1);
  return rows
    .map((r) => {
      try {
        return JSON.parse(r) as SessionTurn;
      } catch {
        return null;
      }
    })
    .filter((x): x is SessionTurn => Boolean(x));
}

export function formatHistoryForPrompt(turns: SessionTurn[], maxChars = 1800): string {
  if (!turns.length) return '';
  const lines = turns.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`);
  const joined = lines.join('\n');
  return joined.length > maxChars ? joined.slice(-maxChars) : joined;
}
