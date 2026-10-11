# Changelog

## Unreleased — LokiTS fork

* documented the modernization roadmap and fork status
* removed obsolete Travis CI and Bower metadata
* renamed the development package to `loki-ts`
* new toolchain: pnpm, Biome, Vitest, tsup (ESM + CJS + d.ts), strict TypeScript config
* persistence methods (saveDatabase, loadDatabase, deleteDatabase, close, throttledSaveDrain) return promises and keep accepting their callbacks; with a callback the promise never rejects
* persistence now settles asynchronously (a microtask later) even with synchronous adapters; code that relied on same-tick completion must await
* new `Loki.open(filename, options)` creates and loads a database in one await; autosave is enabled only after a successful load, so a failed open leaves no timer running
* promise-based adapter contract (`LokiAdapter`, `LokiIncrementalAdapter`); callback adapters stay supported (`LegacyLokiAdapter`, `LokiPersistenceAdapter` is deprecated)
* LokiMemoryAdapter and LokiPartitioningAdapter return promises; LokiPartitioningAdapter stops at the first inner error
* fix: saves requested during loadDatabase stalled the save queue forever; they now run after the load
* fix: the save queue could run two saves at once (a load starting while a save was in flight, overlapping loads, an adapter throwing synchronously); it never does now
* fix: a failed save left collections marked clean (normal and reference modes), so autosave never retried and changes were lost; they stay dirty now
* fix: throttledSaveDrain triggered an extra save, and with `recursiveWait: false` answered `undefined` instead of a boolean
* fix: close(callback) registered the callback as a permanent `close` listener, so it ran again on every later close; the callback now runs once, after `close` is emitted, and an exception it throws surfaces asynchronously
* fix: an incremental adapter calling getLokiCopy twice produced two save outcomes
* adapter bridge: a method that declares its callback parameter is followed by that callback (a promise it returns early, e.g. a callback adapter written as a promise chain, no longer wins and drops the data); its returned promise still counts when it rejects, and on a load when it resolves data or `null`; a write that declares an extra parameter must call it. A method that does not declare one and returns a promise is followed by whichever of the promise and the callback settles first
* a save requested while a load runs is cancelled if that load fails (rejected with an error whose `cause` is the load error), so it cannot overwrite storage with the in-memory state; saves requested afterwards run normally
* fix: in reference mode (LokiPartitioningAdapter) a change made during an export lost its dirty flag, and the incremental rollback after a failed save broke when a collection was added or removed meanwhile
* `Loki.open` ignores the `autoload` and `autoloadCallback` options and does not load when no adapter is configured
* callbacks receive `undefined` on success (previously the raw adapter value), and an unexpected load response is an Error
* autosave and autoload errors without a callback are emitted as `warning` events; a failed persistence call made without a callback is reported the same way instead of becoming an unhandled rejection (awaited or not, the warning is emitted; awaiting callers also get the rejection); one failed throttled save emits one warning per waiting caller that has no callback; a `warning` listener that throws is rethrown from a timer
* BREAKING: the `warning` payload is typed `unknown` instead of `string`; TypeScript listeners typed `(msg: string) => …` no longer compile
* LokiFsAdapter writes atomically (unique temporary file, fsync, rename, directory fsync), returns promises, keeps the error `code` (`EACCES`, `ENOSPC`…) and implements two optional adapter capabilities: line streams (`LokiLineStreamAdapter`) and key listing (`LokiKeyListingAdapter`)
* BREAKING: LokiFsAdapter no longer has a public `fs` field (it could be replaced, e.g. by memfs in tests) nor a `require('fs')` fallback: it needs `process.getBuiltinModule` (Node >= 20.16). deleteDatabase of a missing file now succeeds instead of failing
* a directory fsync failure fails the save unless its code means that the system does not support it (EISDIR, EINVAL, EPERM, EACCES, ENOTSUP, EOPNOTSUPP, EBADF)
* a crash during a write can leave a hidden temporary file (`.<name>.<pid>.<random>.tmp`) next to the target; it is not removed automatically
* `LokiLineStreamAdapter.readLines` yields batches of lines (`AsyncIterable<string[]>`), not one line at a time
* BREAKING: LokiFsAdapter rejects with `EISDIR` when the path is a directory; it used to load an empty database (any `stat` failure did). A missing file still loads as a missing database
* LokiPartitioningAdapter commits through a generation manifest stored in the container: new files are written first and replacing the container commits them, so a crash during a save leaves the previous state readable. Manifest file names are relative to the database (a moved or copied database reads its own files) and validated before anything is read or deleted. It streams collections when the inner adapter supports line streams, and gains deleteDatabase
* LokiPartitioningAdapter runs loads, saves and deletes of the same database one at a time; its undocumented internal fields `dbref`, `dbname`, `pageIterator` and `dirtyPartitions` are gone (its state is kept in private fields). The option types `LokiPartitioningAdapterOptions`, `LegacyFormat` and `LokiFsStructuredAdapterOptions` are exported
* LokiPartitioningAdapter rereads the container at the start of every save: when another writer (process or adapter instance) committed in between, it rewrites every collection instead of reusing files it no longer knows. There is no lock: a save during which another writer commits fails with an error and commits nothing
* files of an interrupted save are removed by a later save only when the inner adapter can list keys (LokiFsAdapter can); without `listKeys` they stay on storage. Only generation files (`<db>.<n>.g<generation>-<suffix>`) are ever deleted from a listing
* new LokiFsStructuredAdapter (one file per collection, one document per line, streamed, only modified collections rewritten) replaces loki-fs-structured-adapter.js and opens its files; its only option is `generations`
* new LokiEncryptedAdapter wraps a string adapter (not a reference or incremental one) and encrypts what it stores with AES-256-GCM (WebCrypto, PBKDF2-SHA256, 600 000 iterations by default); it replaces loki-crypted-file-adapter.js and reads its files. Iterations are bounded, key parameters read from a file are adopted only after it authenticates and never below the configured cost, and the secret is kept as a non-extractable key in private fields. Each stored value is authenticated on its own, not the database as a whole: someone able to write to the storage can put back an older copy of a file or swap two encrypted partitions without failing decryption
* saves to disk pay for their fsyncs and are slower than lokijs; partitioned loads are on par with lokijs (`pnpm bench:fs`)
* fix: renameCollection did not mark the collection dirty, so autosave skipped a rename alone, and a partitioned save could reload a collection renamed over another (or swapped) with the other's documents
* fix: removeCollection did not mark the following collections dirty, so a partitioned save with `generations: false` (the layout lokijs reads) reloaded them with the documents of the collection previously at their position
* fix: fs-structured databases without collections never finished loading; a corrupted line was reported and the load carried on; write errors were ignored
* fix: the crypted adapter was a singleton with one secret per process, failed on a missing database and did not detect modified files
* fix: LokiFsAdapter lost error codes and could leave a temporary file or a truncated database after a failure; LokiPartitioningAdapter had no deleteDatabase
* removed: loki-fs-sync-adapter.js (synchronous I/O, called its callback twice on a missing file); LokiFsAdapter reads the same files
* new LokiIndexedDBAdapter: TypeScript port of the incremental IndexedDB adapter (only the chunks of 100 documents that changed are rewritten). It keeps the storage format, so it reads and writes databases of the lokijs incremental adapter. It returns promises (the callback stays optional), queues the operations of one instance, reports errors with a stable `code` (`ENOTSUP`, `EQUOTA`, `EBUSY`) and has `isSupported()`
* new LokiOpfsAdapter: stores a database in the origin private file system, one file per key replaced atomically when the write completes. It streams lines and lists keys, so LokiPartitioningAdapter can keep one file per collection. It reports `EBUSY` when a synchronous access handle (a Worker) holds the file, and has `isSupported()`
* LokiLocalStorageAdapter returns promises (the callback stays optional) and reports a full storage with the code `EQUOTA`
* fix (incremental IndexedDB): a collection whose name contained a dot made the database unreadable
* fix (incremental IndexedDB): documents written before `clear()`, or before `removeCollection` of a collection later added again under the same name, came back on the next load (only the chunks of the changed documents were rewritten, the older ones beyond the new `maxId` stayed); a save after a collection was cleared, removed, recreated or added now rewrites every chunk and deletes the others. Renaming a collection made the database unreadable on lokijs (no metadata under the new name, load fails with a TypeError)
* fix (incremental IndexedDB): renaming a collection to a name already stored (two collections swapping names, or a removed collection's name reused by a rename) mixed their documents on the next load; a rename now rewrites every chunk of the collection
* fix (incremental IndexedDB): the first save after `loadJSON` wrote only the documents marked dirty, so a database filled with `loadJSON` could not be read back by lokijs (TypeError on load); the first save now writes everything
* fix (incremental IndexedDB): an open blocked by another tab made every later operation of the adapter fail; one adapter used for two databases mixed them up; two operations started at once threw instead of running one after the other; a failed delete was reported as `{ success: false }` instead of an error
* fix: a collection loaded lazily (a `getData` function on a collection given to `loadJSONObject`, as `lazyCollections` does) had a read-only `data` array: removals made after the load were silently ignored and `clear()` before the first read threw
* BREAKING: loki-indexed-adapter.js, incremental-indexeddb-adapter.js and Loki.getIndexedAdapter() are gone. A database saved with the incremental adapter opens as is with LokiIndexedDBAdapter; one saved with the legacy LokiIndexedAdapter (one JSON string per key, catalog store) must be migrated (recipe in tutorials/Persistence Adapters.md)
* BREAKING: the legacy files aws-s3-sync-adapter.js (Simon Hutchison), jquery-sync-adapter.js and loki-angular.js (Joe Minichino), loki-nativescript-adapter.js (Stefano Falda) and the unfinished loki-incremental-adapter.js are gone, with the Loki Angular tutorial. They were not part of the published package. tutorials/Persistence Adapters.md has tested promise-based recipes for an HTTP server, AWS S3 (SDK v3, reads databases stored in base64 by the old adapter) and NativeScript
* BREAKING (storage): partitioned and fs-structured databases are converted to the generation layout on their first save, and encrypted ones to AES-GCM; lokijs cannot read them afterwards. Use `generations: false` to keep a partitioned layout readable by lokijs (without crash safety: a crash during a save can leave the container and the collections out of step, as with lokijs), and back up a database before its first save with LokiTS
* legacy Jasmine/Karma specs ported to Vitest (`tests/`); Karma, PhantomJS, jshint, istanbul, uglify removed
* fix: removeListener no longer removes the last listener when given one that was never registered
* fix: throttledSaveDrain called its callback twice when throttledSaves was false
* fix: Collection.ensureIdAsync threw because `this` was not bound inside the async callback
* fix: stages and commitLog were shared by every collection in the process; each collection now has its own
* fix: KeyValueStore and SortedIndex shared their keys and values between instances, and KeyValueStore.set never found an existing key; setSort now applies to every operation
* the package exports an explicit public API instead of every internal helper; the static members of the original module (Loki.Collection, Loki.LokiOps, Loki.persistenceAdapters, ...) are now typed
* `require('loki-ts')` returns the Loki constructor itself, as the original `lokijs` module did, with the named exports as properties; the browser global (`window.loki`) will come with an IIFE bundle
* BREAKING: core classes are now ES classes; ES5-style subclassing via `Collection.apply(this, args)` / `X.prototype = new Collection()` no longer works, use `class extends`
* supported runtime: Node >= 20.16 (CI also covers 22, 24, 26); development requires Node >= 22.12

The entries below are the historical LokiJS changelog retained for provenance.

* add IncrementalIndexedDBAdapter
* make ensureIndex faster
* LokiEventEmitter.emit faster
* make batch inserts faster (add option to overrideAdaptiveIndices)

## 1.5.6
* added support for indexes on nested properties (#718)
* more robust environment detection (#717)
* precompile $regex filters recursively (#710)
* Corrected $aeq example in Query Examples (#706)
* change 'shallow-recurse-objects' clone to support deep array clone (#692)
* jsdoc fixes for compoundsort example (#691)

## 1.5.5
* fixed issue where batch removes did not update unique index (#677)

## 1.5.4
* fixes to checkIndex maintenance fn (#654, #661)
* bulk remove optimizations (#663)
* fix to meta when cloning (#666)
* AWS S3 sync adapter added (#670)
* fix for browser project: fs not found (#674)
* added comparators to default export (#672)

## 1.5.3
* simplesort can leverage binary index (via index intersect) when weakly filtered (#645)
* the simplesort 'descending' param is now multipurposed (with bw-compat) see jsdocs
* added new simplified js comparison ops for unindexed optimizations (commit bb011d)
* added collection.checkIndex() and collection.checkIndexes() for diagnostics (#654,#47)

## 1.5.2
* fixed error when transform steps have non-serializable parameters (#624)
* addCollection will return existing collection when collection named already exists (#635)
* batch updates when not cloning no longer risk invalidating adaptive binary indices (#639)
* fixed autosave race condition when using async adapter (#643)
* collection option added to disableMeta if not using changes api or ttl (#644)

## 1.5.1
* added disableDeltaChangesApi (default:true) collection option to store only differences. (#582)
* loki indexed adapter deleteDatabase method will now wait until complete before callback (#584)
* fixed clone methods correctly assigning object prototypes (#586)
* partitioning adapter and memory adapter no longer throw error when database doesn't exist (yet)
* simplesort and compoundsort now support sorting on nested properties via dot-notation (#574)
* added support for binary indices on nested properties (#574)
* fixed jsdoc syntax error causing vscode to crash (#614)
* fixed error when using partitioning adapter with nativescript adapter (#615)
* added optional 'dataOptions' to eqJoin and map (chain/transform) (see #618)

## 1.5.0
* refactored binary indices sorting order
* date values in properties with binary index will be converted to epoch time
* fix to LokiFsStructuredAdapter first time autoload error where file doesn't exist yet
* fixed simplesort descending with binary indices and no filters
* with 'clone' option collection 'insert' events no longer emit internal obj reference
* fix to clone method 'shallow'
* added 'removeMeta' option to chained data calls to shallow clone and remove $loki and meta
* added quickstart examples for node and updated loki sandbox with online web quickstarts
* fixes to async unit tests
* npm release trimmed from 5 megs to 500k (no examples, jsdocs, tests)

## 1.4.3
* added throttled saves and loads (enabled by default) to ensure no overlapping calls
* unfiltered simplesorts can leverage binary index
* collection.clear now clears indices correctly
* fix to LokiPartitioning adapter resetting maxId across saves
* meta set correctly on batch inserts
* LokiMemoryAdapter now configurable to simulate async
* fix changesApi not enabled after loading database

## 1.4.2
* added 'adaptiveBinaryIndices' option to collections (default true) to avoid rebuilds on inserts/updates/removes
* added higher performance LokiFsStructuredAdapter for node
* added destructured serialization methods for partitioning and exporting
* added 'addListener' method alias of 'on' method
* LokiFsAdapter doesn't throw exception when file doesn't exist (yet)
* fix for circular structure error when setting ttl
* fix unit testing on windows
* experimental implementation of an incremental adapter

## 1.4.1
* minor fixes
* updated jsdoc coverage

## 1.4.0
* fixes to loki indexed adapter
* added nativescript adapter
* added $aeq, $contains, $containsAny, $ne
* fix unique index update with new object
* expose persistence adapters to module export
* fix to loki-crypted-file-adapter

## 1.3.0

* UniqueIndex and `by()` method
* staging API
* count() utility method
* RethinkDB-style joins (eqJoin)
* moved testing to Karma
* moved builds and run to npm instead of gulp
* added $containsAny operator
* statistical functions: average, max, maxRecord, min, minRecord, median, mode
* extract() to extract a flat array of values for one field in each record
* extractNumerical() - same as extract() for numerical values
* pre-insert and pre-update events
