import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, joinLines, splitLineBatches } from '../../src/adapters/lines';

async function* from(...texts: string[]) {
  yield* texts;
}

async function collect(texts: AsyncIterable<string>): Promise<string[][]> {
  const batches: string[][] = [];
  for await (const batch of splitLineBatches(texts)) {
    batches.push(batch);
  }
  return batches;
}

async function collectChunks(lines: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of joinLines(lines)) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('splitLineBatches', () => {
  it('yields one batch per received piece and keeps unterminated tails', async () => {
    expect(await collect(from('a\nb', 'c\nd\n', 'e'))).toEqual([['a'], ['bc', 'd'], ['e']]);
  });

  it('strips carriage returns and keeps empty lines', async () => {
    expect(await collect(from('a\r\n\r\nb\r\n'))).toEqual([['a', '', 'b']]);
  });

  it('emits nothing for empty input', async () => {
    expect(await collect(from())).toEqual([]);
    expect(await collect(from(''))).toEqual([]);
  });

  it('joins a line split over many pieces', async () => {
    const pieces = Array.from({ length: 1000 }, () => 'x');
    expect(await collect(from(...pieces, '\n'))).toEqual([['x'.repeat(1000)]]);
  });
});

describe('joinLines', () => {
  it('ends every line with a newline', async () => {
    expect((await collectChunks(from('a', '', 'b'))).join('')).toBe('a\n\nb\n');
  });

  it('emits nothing for no lines', async () => {
    expect(await collectChunks(from())).toEqual([]);
  });

  it('groups lines into chunks of about the shared chunk size', async () => {
    const line = 'x'.repeat(1000);
    const count = Math.ceil((CHUNK_SIZE * 2.5) / (line.length + 1));
    const chunks = await collectChunks(from(...Array.from({ length: count }, () => line)));
    expect(chunks.length).toBe(3);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.length).toBeGreaterThanOrEqual(CHUNK_SIZE);
      expect(chunk.length).toBeLessThan(CHUNK_SIZE + line.length + 1);
    }
    expect(chunks.join('')).toBe(`${line}\n`.repeat(count));
  });
});
