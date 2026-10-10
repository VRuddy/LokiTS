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
* callbacks receive `undefined` on success (previously the raw adapter value), an unexpected load response is an Error, and `loaded` is emitted before the loadDatabase callback
* autosave and autoload errors without a callback are emitted as `warning` events; a failed persistence call made without a callback and without awaiting is reported the same way instead of becoming an unhandled rejection (awaiting callers still get the rejection, and the warning is emitted too); the `warning` payload is typed `unknown`
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
