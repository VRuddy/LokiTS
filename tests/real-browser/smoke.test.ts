import { describe, expect, it } from 'vitest';
import { Loki } from '../../src';

describe('real browser', () => {
  it('runs Loki in the page', () => {
    const db = new Loki('smoke.db');
    db.addCollection<{ name: string }>('users').insert({ name: 'odin' });
    expect(db.getCollection('users')?.count()).toBe(1);
    expect(typeof indexedDB).toBe('object');
  });
});
