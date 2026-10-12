import { describe, expect, it } from 'vitest';
import { CITIES, cloneDocs, generateDocs, makeParams } from '../src/core/data.ts';

describe('generateDocs', () => {
  it('is deterministic for a seed', () => {
    expect(generateDocs(50, 7)).toEqual(generateDocs(50, 7));
    expect(generateDocs(50, 7)).not.toEqual(generateDocs(50, 8));
  });

  it('respects the documented shape', () => {
    const docs = generateDocs(2000);
    expect(new Set(docs.map((d) => d.email)).size).toBe(2000);
    expect(docs.map((d) => d.id)).toEqual([...Array(2000).keys()]);
    for (const d of docs) {
      expect(d.age).toBeGreaterThanOrEqual(18);
      expect(d.age).toBeLessThanOrEqual(80);
      expect(CITIES).toContain(d.city);
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThan(1);
      expect(d.tags).toHaveLength(3);
    }
  });
});

describe('cloneDocs', () => {
  it('gives copies that engines can mutate', () => {
    const docs = generateDocs(3);
    const copies = cloneDocs(docs);
    (copies[0] as unknown as Record<string, unknown>).$loki = 1;
    copies[0].tags.push('x');
    expect(docs[0]).not.toHaveProperty('$loki');
    expect(docs[0].tags).toHaveLength(3);
  });
});

describe('makeParams', () => {
  it('draws 1024 values per query from the data', () => {
    const docs = generateDocs(500);
    const p = makeParams(docs);
    expect(p.emails).toHaveLength(1024);
    expect(p.emails.every((e) => docs.some((d) => d.email === e))).toBe(true);
    expect(p.ages.every(([lo, hi]) => hi === lo + 2)).toBe(true);
    expect(p.ids.every((id) => id >= 0 && id < 500)).toBe(true);
    expect(new Set(p.removeIds).size).toBe(p.removeIds.length);
    expect(p.removeIds.length).toBe(250);
  });
});
