# LokiTS

**English** | [Français](README.fr.md)

An in-memory document database written in strict TypeScript. Queries are synchronous and run in memory;
persistence is asynchronous and goes to OPFS, IndexedDB, localStorage or the file system. LokiTS is the
maintained successor to [LokiJS](https://github.com/techfort/LokiJS) and to its TypeScript rewrite LokiDB, which
are no longer developed.

```ts
import { Loki } from '@lokits/core';

const db = await Loki.open('app.db', { autosave: true });
const users = db.getCollection<{ name: string; age: number }>('users') ?? db.addCollection('users');

users.insert({ name: 'odin', age: 50 });
users.find({ age: { $gte: 40 } }); // [{ name: 'odin', age: 50, $loki: 1, meta: { ... } }]
```

## Why LokiTS

- **Typed end to end**: collections, queries, events and options are typed; the code base is strict TypeScript.
- **Promise API**: `Loki.open`, `await db.saveDatabase()`; callbacks keep working for existing code.
- **Modern storage**: OPFS with atomic writes, native IndexedDB that only rewrites what changed, crash-safe file
  writes in Node.js, AES-GCM encryption.
- **Compatible with LokiJS**: same queries, indexes and Dynamic Views; databases saved by LokiJS open as they are
  (one legacy IndexedDB adapter needs a short migration).
- **No runtime dependencies**, ESM and CommonJS builds, tested in Node.js, Chromium, Firefox and WebKit.

## Install

```sh
pnpm add @lokits/core   # or npm install @lokits/core
```

## Persistence

Pick an adapter for your environment, or none to keep the database in memory. Without an adapter, LokiTS uses
the file system in Node.js and localStorage in the browser.

| Adapter | Environment | Use it for |
|---|---|---|
| `LokiFsAdapter` (default in Node.js) | Node.js | One file per database, written atomically |
| `LokiFsStructuredAdapter` | Node.js | Large databases: one file per collection, streamed, only changed collections rewritten |
| `LokiOpfsAdapter` | Browser, Worker | Origin private file system, files replaced atomically |
| `LokiIndexedDBAdapter` | Browser | IndexedDB, only the changed chunks rewritten |
| `LokiLocalStorageAdapter` (default in the browser) | Browser | Small databases (about 5 MB) |
| `LokiPartitioningAdapter` | Anywhere | One key per collection on top of another adapter |
| `LokiEncryptedAdapter` | Anywhere | AES-256-GCM encryption on top of another adapter |
| `LokiMemoryAdapter` | Anywhere | Tests |

```ts
import { Loki, LokiIndexedDBAdapter, LokiOpfsAdapter, LokiPartitioningAdapter } from '@lokits/core';

const adapter = (await LokiOpfsAdapter.isSupported())
  ? new LokiPartitioningAdapter(new LokiOpfsAdapter({ directory: 'my-app' }))
  : new LokiIndexedDBAdapter();
const db = await Loki.open('app.db', { adapter });
```

```ts
import { Loki, LokiEncryptedAdapter, LokiFsAdapter } from '@lokits/core';

const adapter = new LokiEncryptedAdapter(new LokiFsAdapter(), { secret: process.env.DB_SECRET! });
const db = await Loki.open('app.db', { adapter });
```

Browsers may evict this storage when space runs low: call `navigator.storage.persist()` to ask for persistent
storage. Writing your own adapter takes a few lines; see the
[Persistence Adapters](tutorials/Persistence%20Adapters.md) tutorial, which has recipes for an HTTP server, AWS
S3 and NativeScript.

## Features

- MongoDB-style queries (`$eq`, `$gt`, `$in`, `$regex`, `$and`, `$or`…) and chainable result sets with sorting,
  joins, map and reduce ([Query Examples](tutorials/Query%20Examples.md))
- Unique, exact and adaptive binary indexes ([Indexing and Query performance](tutorials/Indexing%20and%20Query%20performance.md))
- Dynamic Views: live, incrementally updated subsets of a collection
- Named, parameterized transforms ([Collection Transforms](tutorials/Collection%20Transforms.md))
- Changes API to track inserts, updates and removals ([Changes API](tutorials/Changes%20API.md))
- Document TTL, autosave, autoload and throttled saves

## Coming from LokiJS

Replace `lokijs` with `@lokits/core` and update your imports; the API is the same, and callbacks still work.
The [changelog](CHANGELOG.md) lists the breaking changes and the migration steps. Back up partitioned,
fs-structured and encrypted databases before their first save with LokiTS: they switch to a crash-safe format
that LokiJS cannot read.

## Compatibility

- Node.js 20.16 or later
- Browsers with ES2022 support; tested in Chromium, Firefox and WebKit

## Status

LokiTS is approaching 1.0. Coming next: published benchmarks against LokiJS and other in-browser databases, and a
documentation site.

## Development

```sh
pnpm install         # Node.js 22.12 or later
pnpm test            # unit tests (Vitest)
pnpm test:browser    # tests in Chromium, Firefox and WebKit (Playwright)
pnpm check           # lint and format (Biome)
pnpm typecheck
pnpm build           # dist/: ESM, CommonJS, type declarations
```

## Credits

LokiTS is built on LokiJS, created by Joe Minichino ([TechFort](https://github.com/techfort/LokiJS)), with major
contributions from Dave ([obeliskos](https://github.com/obeliskos)), Radek Pietruszewski
([radex](https://github.com/radex)), and the LokiJS contributors, including Hans Klunder, Simon Hutchison and
Stefano Falda. LokiTS is an independent project, not an official release of LokiJS or TechFort.

## License

[MIT](LICENSE.txt). Copyright (c) 2026 VRuddy; LokiJS copyright (c) 2015 TechFort.
