export const CHUNK_SIZE = 256 * 1024;

const stripCarriageReturn = (line: string) => (line.endsWith('\r') ? line.slice(0, -1) : line);

/**
 * Splits decoded text into batches of lines, one batch per piece, sparing an async step per line.
 * The unterminated tail is kept as pieces: joining on every piece would make a very long line quadratic.
 */
export async function* splitLineBatches(texts: AsyncIterable<string>): AsyncGenerator<string[]> {
  let pending: string[] = [];
  for await (const text of texts) {
    if (!text.includes('\n')) {
      pending.push(text);
      continue;
    }
    const lines = text.split('\n');
    lines[0] = pending.join('') + lines[0];
    pending = [lines.pop() as string];
    yield lines.map(stripCarriageReturn);
  }
  const last = pending.join('');
  if (last !== '') {
    yield [stripCarriageReturn(last)];
  }
}

/** Joins lines, each ended by a newline, into chunks of at least `CHUNK_SIZE` (the last may be smaller). */
export async function* joinLines(lines: AsyncIterable<string>): AsyncGenerator<string> {
  let chunk = '';
  for await (const line of lines) {
    chunk += `${line}\n`;
    if (chunk.length >= CHUNK_SIZE) {
      yield chunk;
      chunk = '';
    }
  }
  if (chunk) {
    yield chunk;
  }
}
