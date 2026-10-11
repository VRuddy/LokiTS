# Changelog

All notable changes to LokiTS are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - Unreleased

First release of LokiTS, a TypeScript rewrite of [LokiJS](https://github.com/techfort/LokiJS) 1.5.12. The query
engine, indexes, Dynamic Views, transforms and the serialized database format are the same; this entry lists
what differs from LokiJS.

### Breaking changes

- The package is `@lokits/core`. `require('@lokits/core')` still returns the `Loki` constructor, with the named
  exports as properties; `import { Loki } from '@lokits/core'` is the recommended form.
- Core classes are ES classes. ES5-style subclassing (`Collection.apply(this, args)`,
  `X.prototype = new Collection()`) no longer works: use `class extends`.
- Node.js 20.16 or later is required.
- Persistence settles asynchronously, a microtask later, even with a synchronous adapter. Code that relied on a
  save or load completing in the same tick must `await` it.
- Removed adapters and files: `loki-indexed-adapter.js` (`LokiIndexedAdapter`), `incremental-indexeddb-adapter.js`,
  `Loki.getIndexedAdapter()`, `loki-fs-sync-adapter.js`, `loki-crypted-file-adapter.js`,
  `loki-fs-structured-adapter.js` (replaced by built-in adapters), and the community files
  `aws-s3-sync-adapter.js`, `jquery-sync-adapter.js`, `loki-nativescript-adapter.js`, `loki-angular.js`. The
  tutorials give replacement recipes and a migration path for `LokiIndexedAdapter` databases.
- Storage formats: partitioned and fs-structured databases switch to a crash-safe layout on their first save, and
  encrypted databases to AES-GCM. LokiJS cannot read them afterwards; pass `generations: false` to keep a
  partitioned layout LokiJS can read, and back up a database before its first save with LokiTS.
- `LokiLocalStorageAdapter` passes `undefined` instead of `null` to the save callback on success.

### Added

- Promise API: `loadDatabase`, `saveDatabase`, `deleteDatabase`, `close` and `throttledSaveDrain` return promises
  and still accept their callbacks. `Loki.open(filename, options)` creates and loads a database in one `await`.
- Full TypeScript types: typed collections (`Collection<T>`), queries (`LokiQuery<T>`), events and options.
- `LokiOpfsAdapter`: stores databases in the origin private file system, each file replaced atomically; works
  alone or under `LokiPartitioningAdapter`.
- `LokiIndexedDBAdapter`: native IndexedDB adapter that only rewrites the chunks that changed. It keeps the storage
  format of the LokiJS incremental IndexedDB adapter, so existing databases open as they are.
- `LokiFsAdapter` writes atomically (temporary file, fsync, rename) and streams large databases.
- `LokiPartitioningAdapter` and `LokiFsStructuredAdapter` commit each save as a whole: a crash during a save leaves
  the previous state readable.
- `LokiEncryptedAdapter`: AES-256-GCM encryption around any string adapter, with tamper detection; it reads files
  encrypted by the LokiJS crypted adapter.
- Adapter errors carry a stable `code` (`ENOTSUP`, `EQUOTA`, `EBUSY`, `EINVAL`, `ENOENT`); browser adapters have
  `isSupported()`.
- Promise-based adapter contract (`LokiAdapter`); callback adapters written for LokiJS keep working.
- ESM and CommonJS builds with type declarations; no runtime dependencies.

### Fixed

Bugs inherited from LokiJS 1.5.12:

- Events: `removeListener` with a listener that was never registered removed the last listener.
- Shared state: `stages` and `commitLog` were shared by every collection in the process, and `KeyValueStore` and
  `SortedIndex` shared their data between instances.
- `ensureIdAsync` threw; `throttledSaveDrain` called its callback twice without throttling and triggered an extra
  save.
- Save queue: saves requested during a load stalled forever, two saves could run at once, and a failed save left
  collections marked clean, so the changes were never saved again. `close(callback)` ran the callback again on
  every later close.
- `renameCollection` and `removeCollection` did not mark collections dirty, so a partitioned save could reload a
  collection with the documents of another.
- File adapters lost error codes, could leave a truncated database after a failure, and fs-structured databases
  without collections never finished loading. The crypted adapter used one secret per process and did not detect
  modified files.
- Incremental IndexedDB: collection names with a dot, renamed, removed, cleared or recreated collections, and the
  first save after `loadJSON` could make the database unreadable or bring back deleted documents. Concurrent
  operations, an open blocked by another tab and a failed delete are handled.
- Collections loaded lazily had a read-only `data` array, so removals after the load were silently ignored.

### Migrating from LokiJS

1. Replace the `lokijs` dependency with `@lokits/core` and update imports:
   `import { Loki, LokiFsAdapter } from '@lokits/core'`.
2. Callbacks keep working; you can move to `await db.saveDatabase()` and `await Loki.open(name, options)` at
   your own pace.
3. Rewrite ES5-style subclasses of LokiJS classes as `class extends`.
4. If you used a removed adapter, switch to its replacement: `LokiIndexedDBAdapter` for the IndexedDB adapters
   (with the migration recipe for `LokiIndexedAdapter`), `LokiFsAdapter` for the sync adapter,
   `LokiEncryptedAdapter` for the crypted adapter, `LokiFsStructuredAdapter` for the fs-structured adapter.
   See [Persistence Adapters](tutorials/Persistence%20Adapters.md).
5. Back up partitioned, fs-structured and encrypted databases before their first save with LokiTS, or pass
   `generations: false` if LokiJS must still read them.
