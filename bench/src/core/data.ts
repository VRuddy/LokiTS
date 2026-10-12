export interface BenchDoc {
  id: number;
  name: string;
  email: string;
  age: number;
  city: string;
  score: number;
  tags: string[];
  createdAt: number;
}

export const CITIES = Array.from({ length: 50 }, (_, i) => `city-${i}`);
const TAGS = ['red', 'green', 'blue', 'black', 'white', 'gold', 'silver', 'pink'];
const PARAM_COUNT = 1024;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDocs(count: number, seed = 42): BenchDoc[] {
  const rand = mulberry32(seed);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const docs = new Array<BenchDoc>(count);
  for (let i = 0; i < count; i++) {
    docs[i] = {
      id: i,
      name: `user-${i}`,
      email: `user-${i}@example.com`,
      age: 18 + Math.floor(rand() * 63),
      city: pick(CITIES),
      score: rand(),
      tags: [pick(TAGS), pick(TAGS), pick(TAGS)],
      createdAt: 1_700_000_000_000 + Math.floor(rand() * 1e10),
    };
  }
  return docs;
}

export function cloneDocs(docs: BenchDoc[]): BenchDoc[] {
  return docs.map((d) => ({ ...d, tags: [...d.tags] }));
}

export interface Params {
  emails: string[];
  cities: string[];
  ages: [number, number][];
  scores: [number, number][];
  compound: [string, number][];
  ids: number[];
  newScores: number[];
  removeIds: number[];
}

export function makeParams(docs: BenchDoc[], seed = 7): Params {
  const rand = mulberry32(seed);
  const n = docs.length;
  const draw = <T>(make: () => T): T[] => Array.from({ length: PARAM_COUNT }, make);
  const removeCount = Math.min(1000, Math.floor(n / 2));
  const removeIds: number[] = [];
  const taken = new Set<number>();
  while (removeIds.length < removeCount) {
    const id = Math.floor(rand() * n);
    if (!taken.has(id)) {
      taken.add(id);
      removeIds.push(id);
    }
  }
  return {
    emails: draw(() => docs[Math.floor(rand() * n)].email),
    cities: draw(() => CITIES[Math.floor(rand() * CITIES.length)]),
    ages: draw((): [number, number] => {
      const lo = 18 + Math.floor(rand() * 61);
      return [lo, lo + 2];
    }),
    scores: draw((): [number, number] => {
      const lo = rand() * 0.99;
      return [lo, lo + 0.01];
    }),
    compound: draw((): [string, number] => [
      CITIES[Math.floor(rand() * CITIES.length)],
      18 + Math.floor(rand() * 53),
    ]),
    ids: draw(() => Math.floor(rand() * n)),
    newScores: draw(() => rand()),
    removeIds,
  };
}
