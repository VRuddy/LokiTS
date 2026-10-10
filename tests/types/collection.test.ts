import { describe, expect, expectTypeOf, it } from 'vitest';
import { Loki } from '../../src';
import type { Collection } from '../../src/core/Collection';
import type { LokiDocument } from '../../src/types/document';

interface User {
  name: string;
  age: number;
}

describe('Collection<T> typings', () => {
  const db = new Loki('types.db');
  const users: Collection<User> = db.addCollection<User>('users', { unique: ['name'] });

  it('types insert, get, by and find results', () => {
    const odin = users.insert({ name: 'Odin', age: 50 });
    expectTypeOf(odin).toEqualTypeOf<LokiDocument<User>>();
    expectTypeOf(users.insert([{ name: 'Thor', age: 35 }])).toEqualTypeOf<LokiDocument<User>[]>();
    expectTypeOf(users.get(odin.$loki)).toEqualTypeOf<LokiDocument<User> | null>();
    expectTypeOf(users.get(odin.$loki, true)).toEqualTypeOf<[LokiDocument<User>, number] | null>();
    expectTypeOf(users.by('name', 'Odin')).toEqualTypeOf<LokiDocument<User>>();
    expectTypeOf(users.find({ age: { $gt: 30 } })).toEqualTypeOf<LokiDocument<User>[]>();
    expectTypeOf(users.where((u) => u.age > 30)).toEqualTypeOf<LokiDocument<User>[]>();
    expect(users.count()).toBe(2);
  });

  it('rejects documents that do not match T', () => {
    // @ts-expect-error age must be a number
    users.insert({ name: 'Loki', age: 'thirty' });
    // @ts-expect-error unknown update callback property
    users.findAndUpdate({ age: 50 }, (u) => u.nope);
  });
});
