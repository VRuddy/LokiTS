# Overview
LokiJS persistence is implemented via an adapter interface.  We support autosave and autoload options, simple key/value adapters as well as 'reference mode' adapters, and now internally support various methods of structured serialization which can ease creation of your own persistence adapters, as well as bulk or streamed data exchange.  

An important distinction between an in-memory database like lokijs and traditional database systems is that all documents/records are kept in memory and are not loaded as needed.  Persistence is therefore only for saving and restoring the state of this in-memory database.

> If your database is small enough and you wish to experiment, you can call db.serialize() to return a full serialization of your database and load it into another database instance such as dbcopy.loadJSON(str).

# Node.js QuickStart
If you are using lokijs in a node environment, we will automatically detect and use the built-in LokiFsAdapter without your needing to provide an adapter.

### No Persistence example (entirely synchronous and in memory) :

```javascript
const loki = require("lokijs");

var db = new loki("quickstart.db");
var users = db.addCollection("users");

users.insert({name:'odin', age: 50});
users.insert({name:'thor', age: 35});

var result = users.find({ age : { $lte: 35 } });

// dumps array with 1 doc (thor) to console
console.log(result);
```

### Autosave/autoload quickstart with default LokiFsAdapter (async i/o) : 

```javascript
var db = new loki('quickstart.db', {
	autoload: true,
	autoloadCallback : databaseInitialize,
	autosave: true, 
	autosaveInterval: 4000
});

// implement the autoloadback referenced in loki constructor
function databaseInitialize() {
  var entries = db.getCollection("entries");
  if (entries === null) {
    entries = db.addCollection("entries");
  }

  // kick off any program logic or start listening to external events
  runProgramLogic();
}

// example method with any bootstrap logic to run after database initialized
function runProgramLogic() {
  var entryCount = db.getCollection("entries").count();
  console.log("number of entries in database : " + entryCount);
}

```

If you expect your database to grow over 100mb or you experience slow save speeds you might to use our more high-performance LokiFsStructuredAdapter. This adapter utilitizes es6 generator iterators and node streams to stream the database line by line.  It will also save each collection into its own file (partitioned) with a file name derived from the base name.  This database should scale to support databases just under 1 gb on the default node heap allocation of 1.4gb.  Increasing heap allocation, you can push this limit further. 

### An example using fastest and most scalable LokiFsStructuredAdapter (for nodejs) might look like : 
```javascript
const { Loki, LokiFsStructuredAdapter } = require('loki-ts');

var adapter = new LokiFsStructuredAdapter();
var db = new Loki('sandbox.db', { 
  adapter : adapter,
  autoload: true,
  autoloadCallback : databaseInitialize,
  autosave: true, 
  autosaveInterval: 4000
});

function databaseInitialize() {
  var log = db.getCollection("log");

  if (log === null) {
    db.addCollection("log");
  }

  // log some random event data as part of our example
  log.insert({ event: 'dbinit', dt: (new Date()).getTime() });
}

```

# Web QuickStart
If you are using lokijs in a web environment, we will automatically use the built-in LokiLocalStorageAdapter.  This adapter is limited to around 5mb so that won't last long but here is how to quickly get started experimenting with lokijs :
```
<script src="../../src/lokijs.js"></script>
```

### Example constructing loki for in-memory only or manual save/load (with default localStorage adapter) :
```javascript
var loki = new loki("test.db");
```

### Example constructing loki for autoload/autosave (with default localStorage adapter) : 
```javascript
var db = new loki("quickstart.db", {
  autoload: true,
  autoloadCallback : databaseInitialize,
  autosave: true, 
  autosaveInterval: 4000
});

function databaseInitialize() {
  if (!db.getCollection("users")) {
    db.addCollection("users");
  }
}

```

If your database outgrows localStorage, use `LokiIndexedDBAdapter` (IndexedDB) or `LokiOpfsAdapter` (origin private file system). Both return promises and still accept the optional callback as last argument. A full localStorage rejects with the code `EQUOTA`.

### Example using LokiIndexedDBAdapter

The database is not saved as one big JSON string but split into small chunks of 100 documents. When saving, only the chunks with changed
documents (and the database metadata) are saved to IndexedDB. This speeds up small incremental
saves by an order of magnitude on large (tens of thousands of records) databases. It also
avoids a Safari 13 bug that would cause the database to balloon in size to gigabytes.

```javascript
import { Loki, LokiIndexedDBAdapter } from 'loki-ts';

const db = await Loki.open('TestDatabase', {
  adapter: new LokiIndexedDBAdapter(),
  autosave: true,
  autosaveInterval: 4000
});
if (!db.getCollection('users')) {
  db.addCollection('users');
}
```

`LokiIndexedDBAdapter` uses the storage format of the incremental IndexedDB adapter of lokijs (`IncrementalIndexedDBAdapter`): databases saved by one open in the other. It is not compatible with `LokiIndexedAdapter`, the adapter that saved one JSON string per key: see 'Migrating from LokiIndexedAdapter' below.

Options (all optional) :
* `lazyCollections` : names of collections whose documents are only parsed when first used.
* `serializeChunk(collectionName, chunk)` and `deserializeChunk(collectionName, chunk)` : transform each chunk of documents before it is stored and after it is read. Pass both or neither.
* `megachunkCount` : number of parallel reads when loading more than 100 chunks (default 24, even, at least 4).
* `onFetchStart`, `onDidOverwrite`, `onversionchange` : see below.

The operations of one adapter instance run one after the other, and one instance can serve several databases. Another tab that saved in between is detected through a version stored with the database: the next save then rewrites every chunk, and `onDidOverwrite` is called. If another tab deletes or upgrades the database, the connection is closed and `onversionchange` is called; the adapter reopens it on the next operation. A connection closed by the browser (site data cleared, IndexedDB process lost) is reopened the same way. Errors carry a `code` : `ENOTSUP` (no IndexedDB), `EBUSY` (opening is blocked by another connection), `EQUOTA` (storage is full), the original error being the `cause`. `await LokiIndexedDBAdapter.isSupported()` tells beforehand whether IndexedDB can be opened (some private browsing modes refuse).

### Example using LokiOpfsAdapter

The origin private file system stores each key in a file of its own, replaced atomically when the write completes: a write that fails midway keeps the previous content. Used alone, a database is one file ; under `LokiPartitioningAdapter` each collection gets its own file, streamed line by line, and a crash during a save leaves the previous state readable.

```javascript
import { Loki, LokiOpfsAdapter, LokiPartitioningAdapter } from 'loki-ts';

if (await LokiOpfsAdapter.isSupported()) {
  const adapter = new LokiPartitioningAdapter(new LokiOpfsAdapter({ directory: 'my-app' }));
  const db = await Loki.open('test.db', { adapter });
}
```

`directory` is a folder of the origin private file system (created when missing, `/` separates levels); without it files go in the root. Keys cannot contain `/`. Errors carry a `code` : `ENOTSUP`, `EQUOTA`, `EBUSY` (a Worker holds a synchronous access handle on the file), `EINVAL` (invalid key). The browser may clear this storage when space runs short: `navigator.storage.persist()` asks for it to be kept.

The adapter writes through `createWritable()`, also in a Worker. A write path using `FileSystemSyncAccessHandle` was measured in Chromium, Firefox and WebKit on 100 000 documents and was not faster, so it is not implemented.

### Migrating from LokiIndexedAdapter

`LokiIndexedAdapter` and `Loki.getIndexedAdapter()` are gone. To move an existing database, keep lokijs installed (`pnpm add lokijs`) and run this function at startup instead of opening the database directly. It opens the database with `LokiIndexedDBAdapter` ; when that finds nothing, it reads the old copy, saves it with the new adapter and deletes the old one. Keep calling it as long as some devices have not migrated: once a database is migrated it only costs one extra read.

```ts
import { Loki, LokiIndexedDBAdapter } from 'loki-ts';
import LokiIndexedAdapter from 'lokijs/src/loki-indexed-adapter.js';

async function migrateFromLokiIndexedAdapter(name: string): Promise<Loki> {
  const db = await Loki.open(name, { adapter: new LokiIndexedDBAdapter() });
  if (db.listCollections().length > 0) {
    return db;
  }
  const legacy = new LokiIndexedAdapter('loki');
  const old = await Loki.open(name, { adapter: legacy });
  if (old.listCollections().length === 0) {
    return db;
  }
  db.loadJSON(old.serialize());
  await db.saveDatabase();
  await old.deleteDatabase();
  return db;
}
```

`'loki'` is the default 'App' context of `LokiIndexedAdapter`: pass the one your application used. A database that was saved through `LokiPartitioningAdapter` is read with `new LokiPartitioningAdapter(legacy)` in place of `legacy` ; `old.deleteDatabase()` then removes the partitions too.

> Community members have also written adapters for this interface (callback style, they still work). Some of these include : 
* Cordova adapter : https://github.com/cosmith/loki-cordova-fs-adapter
* localForage adapter : https://github.com/paulhovey/loki-localforage-adapter

# Configuring persistence adapters
## Autosave, Autoload and close()
LokiJS now supports automatic saving at user defined intervals, configured via loki constructor options.  This is supported for all persistenceMethods.  Data is only saved if changes have occurred since the last save.  You can also specify an autoload to immediately load a saved database during new loki construction.  If you need to process anything on load completion you can also specify your own autoloadCallback.  Finally, in an autosave scenario, if the user wants to exit or is notified of leaving the webpage (window.onbeforeunload) you can call close() on the database which will perform a final save (if needed).

> _**Note : flushing data from an event such as the browser's onbeforeunload only works if the adapter writes before the handler returns. `close()` returns a promise that settles later, but LokiLocalStorageAdapter calls `localStorage.setItem` synchronously inside `close()`, so its final save is written. LokiIndexedDBAdapter and LokiOpfsAdapter write asynchronously: the page may be gone before the write completes, so do not rely on `close()` in onbeforeunload with them. Saving earlier (autosave, or on `visibilitychange` when the page is hidden) is safer.**_


### Autosave example
```javascript
    var idbAdapter = new LokiIndexedDBAdapter();
    var db = new loki('test', 
      {
        autosave: true, 
        autosaveInterval: 10000, // 10 seconds
        adapter: idbAdapter
      });
```

### Autosave with autoload example
```javascript
    var idbAdapter = new LokiIndexedDBAdapter();
    var db = new loki('test.db', 
      {
        autoload: true,
        autoloadCallback : loadHandler,
        autosave: true, 
        autosaveInterval: 10000, // 10 seconds
        adapter: idbAdapter
      }); 

    function loadHandler() {
      // if database did not exist it will be empty so I will intitialize here
      var coll = db.getCollection('entries');
      if (coll === null) {
        coll = db.addCollection('entries');
      }
    }
```
[Try in Loki Sandbox](https://rawgit.com/techfort/LokiJS/master/examples/sandbox/LokiSandbox.htm#rawgist=https://gist.githubusercontent.com/obeliskos/447edca33d1274dd9a64767d23df56e9/raw/740d3bedc1ed76d3718acd207b6913281a11ed78/autoloadCallback).

# Save throttling and persistence contention management
LokiJS now supports throttled saves and loads to avoid overlapping saveDatabase and loadDatabase calls from interfering with each other.  This is controlled by a loki constructor option called 'throttledSaves' and the default for that option is 'true'. 

This means that within any single Loki database instance, multiple saves routed to the persistence adapter will be throttled and ensured to not conflict by overlap.  With save throttling, during the time between an adapter save and an adapter response to that save, if new save requests come in we will queue those requests (and their callbacks) for a save which we will initiate immediately after the current save is complete.  In that situation, if 10 requests to save had been made while a save is pending, the subsequent (single) save will callback all ten queued/tiered callbacks when -it- completes.  

If a loadDatabase call occurs while a save is pending, we will (by default) wait indefinitely for the queue to deplete without being replenished.  Once that occurs we will lock all saves during the load... any incoming save requests made while the database is being loaded will then be queued for saving once the load is completed.  Since loadDatabase now internally calls a new 'throttledSaveDrain' we will pass through options to control that drain. (These options will be summarized below).

You may also directly call this 'throttledSaveDrain' loki method which can wait for the queue to drain. You might do this using any of these variations/options : 

```javascript
    // wait indefinitely (recursively)
    db.throttledSaveDrain(function () {
      console.log("no saves in progress");
    });
```
```javascript
    // wait only for the -current- queue to deplete
    db.throttledSaveDrain(function () {
      console.log("queue drained");
    }, { recursiveWait: false } );
```
```javascript
    // wait recursively but only for so long...
    db.throttledSaveDrain(function (success) {
      if (success) {
        console.log("no saves in progress");
      }
      else {
        console.log("taking too long, try again later");
      }
    }, { recursiveWaitLimit: true, recursiveWaitLimitDuration: 2000 });
```
If you do not wish loki to supervise these conflicts with its throttling contention management, you can disable this by constructing loki with the following option (in addition to any existing options you are passing) : 
```javascript
var db = new loki('test.db', { throttledSaves: false });
```

# Creating your own Loki Persistence Adapters
Lokijs currently supports two types of database adapters : 'basic', and 'reference' mode adapters. Basic adapters are passed a string to save and return a string when loaded... this is well suited to key/value stores.  Reference mode adapters are passed a reference to the database itself where it can save however it wishes to.  When loading, reference mode adapters can return an object reference or serialized string.  Below we will describe the minimal functionality which lokijs requires, you may want to provide additional adapter functionality for deleting or inspecting its persistence store.

# Writing your own adapter
An adapter is an object with `loadDatabase(dbname)`, which resolves to the saved string or to `null` when the database does not exist yet, and `saveDatabase(dbname, data)`; `deleteDatabase(dbname)` is optional. A rejected promise is reported by `loadDatabase()`/`saveDatabase()` on the database. The three recipes below replace adapters that lokijs shipped in `src/` and LokiTS no longer carries; they are tested in `tests/adapters/recipes.test.ts`.

### HTTP server (replaces jquery-sync-adapter.js by Joe Minichino)
The server stores the body of a `PUT`, returns it on `GET` and answers 404 when it has nothing.
```typescript
import type { LokiAdapter } from 'loki-ts';

class HttpAdapter implements LokiAdapter {
  readonly #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  async loadDatabase(dbname: string): Promise<string | null> {
    const response = await fetch(this.#url(dbname));
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`loading ${dbname}: HTTP ${response.status}`);
    }
    return response.text();
  }

  async saveDatabase(dbname: string, data: string): Promise<void> {
    const response = await fetch(this.#url(dbname), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: data,
    });
    if (!response.ok) {
      throw new Error(`saving ${dbname}: HTTP ${response.status}`);
    }
  }

  async deleteDatabase(dbname: string): Promise<void> {
    const response = await fetch(this.#url(dbname), { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new Error(`deleting ${dbname}: HTTP ${response.status}`);
    }
  }

  #url(dbname: string): string {
    return `${this.#baseUrl}/${encodeURIComponent(dbname)}`;
  }
}

const db = await Loki.open('app.db', { adapter: new HttpAdapter('https://example.com/db') });
```

### AWS S3 (replaces aws-s3-sync-adapter.js by Simon Hutchison)
Uses the AWS SDK v3; pass a configured client (credentials come from the SDK's usual configuration, not from the adapter). Databases saved by the lokijs adapter were stored in base64 and are still read.
```typescript
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { LokiAdapter } from 'loki-ts';

class S3Adapter implements LokiAdapter {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(client: S3Client, bucket: string) {
    this.#client = client;
    this.#bucket = bucket;
  }

  async loadDatabase(dbname: string): Promise<string | null> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: dbname }),
      );
      const text = (await response.Body?.transformToString()) ?? '';
      if (text === '') {
        return null;
      }
      // the lokijs aws-s3-sync-adapter stored the database in base64
      return text.startsWith('{') ? text : Buffer.from(text, 'base64').toString();
    } catch (err) {
      if ((err as Error).name === 'NoSuchKey') {
        return null;
      }
      throw err;
    }
  }

  async saveDatabase(dbname: string, data: string): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: dbname,
        Body: data,
        ContentType: 'application/json',
      }),
    );
  }

  async deleteDatabase(dbname: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: dbname }));
  }
}

const db = await Loki.open('app.db', { adapter: new S3Adapter(new S3Client({ region: 'eu-west-1' }), 'my-bucket') });
```

### NativeScript (replaces loki-nativescript-adapter.js by Stefano Falda)
Stores the database in the app documents folder. `writeText` replaces the file in place: a crash during a save can lose the database.
```typescript
import { knownFolders } from '@nativescript/core';
import type { LokiAdapter } from 'loki-ts';

class NativeScriptAdapter implements LokiAdapter {
  async loadDatabase(dbname: string): Promise<string | null> {
    const folder = knownFolders.documents();
    if (!folder.contains(dbname)) {
      return null;
    }
    const text = await folder.getFile(dbname).readText();
    return text === '' ? null : text;
  }

  async saveDatabase(dbname: string, data: string): Promise<void> {
    await knownFolders.documents().getFile(dbname).writeText(data);
  }

  async deleteDatabase(dbname: string): Promise<void> {
    const folder = knownFolders.documents();
    if (folder.contains(dbname)) {
      await folder.getFile(dbname).remove();
    }
  }
}

const db = await Loki.open('app.db', { adapter: new NativeScriptAdapter() });
```

# Creating your own 'Basic' persistence adapter 

```javascript
MyCustomAdapter.prototype.loadDatabase = function(dbname, callback) {
  // using dbname, load the database from wherever your adapter expects it
  var serializedDb = localStorage[dbname];

  var success = true; // make your own determinations

  if (success) {
    callback(serializedDb);
  }
  else {
    callback(new Error("There was a problem loading the database"));
  }
}
```

and a saveDatabase example might look like : 

```javascript
MyCustomAdapter.prototype.saveDatabase = function(dbname, dbstring, callback) {
  // store the database, for this example to localstorage
  localStorage[dbname] = dbstring;

  var success = true;  // make your own determinations
  if (success) {
    callback(null);
  }
  else {
    callback(new Error("An error was encountered loading " + dbname + " database."));
  }
}
```

# Creating your own 'Reference Mode' persistence adapter 
An additional 'level' of adapter support would be for your adapter to support **'reference'** mode support.  This 'reference' mode will allow lokijs to provide your adapter with a reference to a lightweight 'copy' of the database sharing only the collection.data[] document object instances with the original database. You would use this reference to destructure or save however you want to.

To instruct loki that your adapter supports 'reference' mode, you will need to implement a top level property called 'mode' on your adapter and set it equal to 'reference'.  Having done that and configured that adapter to be used, whenever loki wishes to save the database it will instead call out to an exportDatabase() method on your adapter.  

A simple example of an advanced 'reference' mode adapter might look like : 
```javascript
function YourAdapter() {
   this.mode = "reference";
}

YourAdapter.prototype.exportDatabase = function(dbname, dbref, callback) {
  this.customSaveLogic(dbref);

  var success = true; // make your own determinations

  if (success) {
    callback(null);
  }
  else {
    callback(new Error("some error occurred."));
  }
}

// reference mode uses the same loadDatabase method signature
YourAdapter.prototype.loadDatabase = function(dbname, callback) {
  // do some magic to reconstruct a new loki database object instance from wherever
  var newDatabase = this.customLoadLogic();
 
  var success = true; // make you own determinations

  // once reconstructed, loki will expect either a serialized response or a Loki object instance to reinflate from
  if (success) {
    callback(newSerialized);
  }
  else {
    callback(new Error("some error"));
  }
}
```

# LokiPartitioningAdapter
This is an adapter for adapters.  It wraps around and converts any 'basic' persistence adapter into one that scales nicely to your memory contraints.  It can split your database up, saving each collection independently and only if changes have occurred since the last save.  Since each collection is saved separately there is lower memory overhead and since only dirty collections are saved there is improved i/o save speeds. 
> Chrome (using indexedDb) places a restriction on how large a single saved 'chunk' can be, this Partitioning adapter with just partitioning raises that limit from being 'per db' to 'per collection'... when paging is enabled that limit is raised to being 'per document'.  Chrome indexedDb limit is somewhere around 30-60megs sized chunks.  

An example using partition adapter with our LokiOpfsAdapter might appear such as (LokiIndexedDBAdapter already stores small chunks and does not need partitioning) :

```javascript
var opfsAdapter = new LokiOpfsAdapter({ directory: 'appAdapter' });
var pa = new LokiPartitioningAdapter(opfsAdapter);

var db = new Loki('sandbox.db', { adapter: pa });
```

If you expect a single collection to grow rather large you may even want to utilize an additional 'paging' mode that this adapter provides.  This is useful if you want to limit the size of data sent to the inner persistence adapter. This paging mode was added to accomodate a Chrome limitation on maximum record sizes.  An example using paging mode might appear as follows :
```javascript
var opfsAdapter = new LokiOpfsAdapter({ directory: 'appAdapter' });
var pa = new LokiPartitioningAdapter(opfsAdapter, { paging: true });

var db = new Loki('sandbox.db', { adapter: pa });
```

You can also pass in a pageSize option if you wish to use a page size other than the default 25meg page size.
```javascript
// set up adapter to page using 35 meg page size
var pa = new LokiPartitioningAdapter(opfsAdapter, { paging: true, pageSize:35*1024*1024 });
```

# LokiMemoryAdapter
This 'basic' persistence adapter is only intended for experimenting and testing since it retains its key/value store in memory and will be lost when session is done.  This enables us to verify the partitioning adapter works and can be used to mock persistence for unit testing. 

You might access this memory adapter (which is included in the main source file) similarly to the following :
```javascript
var mem = new loki.LokiMemoryAdapter();
var db = new loki('sandbox.db', {adapter: mem});
```

If you wish to simulate asynchronous 'basic' adapter you can pass options to its constructor : 
```javascript
// simulate 50ms async delay for loads and saves. this will yield thread until then
var mem = new loki.LokiMemoryAdapter({ asyncResponses: true, asyncTimeout: 50 });
var db = new loki('sandbox.db', {adapter: mem});
```

> In order to see LokiPartitioningAdapter used in conjunction with LokiMemoryAdapter you can view this [Loki Sandbox gist](https://rawgit.com/techfort/LokiJS/master/examples/sandbox/LokiSandbox.htm#rawgist=https://gist.githubusercontent.com/obeliskos/15c1aa87da16cd89b328eb84bbcdf8fa/raw/d91ac3fee212dc5aa96cb05f479d825faa17c1c8/PartitionedMemoryAdapterTest) in your browser.  

What is happening in the gist linked above is that we create an instance of a LokiMemoryAdapter and pass that instance to the LokiPartitioningAdapter.  We utilimately pass in the created LokiPartitioningAdapter instance to the database constructor.  We then add multiple collections to our database, save it, update one of the collections (causing that collection's 'dirty' flag to be set), and save again.  When we examine the output of the script we can view the contents of the memory adapter's internal hash store to see how there are multiple keys for a single database.  We can also see that our modified collection (along with the database container itself) was saved again.  The database container currently has no 'dirty' flag set but since we remove all collection.data[] object instances from it, it is relatively lightweight.

# 'Rolling your own' structured serialization mechanism
In addition to the [ChangesAPI](https://github.com/techfort/LokiJS/wiki/Changes-API) which can be utilized to isolate changesets, LokiJS has established several internal utility methods to assist users in developing optimal persistence or transmission of database contents. 

Those mechanisms include the ability to decompose the database into 'partitions' of structured serializations or assembled into a line oriented format (non-partitioned) and either delimited (single delimited string per collection) or non-delimited (array of strings, one per document).  These utility methods are located on the Loki object instance itself as the 'serializeDestructured' and 'deserializeDestructured' methods.  They can be invoked to create structured json serialization for the entire database, or (if you pass a partition option) it can provide a single partition at a time.  Internal loki structured serialization in its current form provides mild memory overhead reduction and decreases I/O time if only some collections need to be saved.  It may also be useful for other data exchange or synchronization mechanisms. 

In lokijs terminology the partitions of a database include the database container (partition -1) along with each individual collection (partitions 0-n).

To destructure in various formats you can experiment with the following parameters :
```javascript
var result = db.serializeDestructured({
  partitioned: false,
  delimited: false
});
```
To destructure a single partition you might use the following syntax and experiment with 'delimited' and 'partition' properties :
```javascript
var result = db.serializeDestructured({
  partitioned: true,
  partition: 1,
  delimited: false
});
```
> To experiment with the various structured serialization formats you can view this [Loki Sandbox gist](https://rawgit.com/techfort/LokiJS/master/examples/sandbox/LokiSandbox.htm#rawgist=https://gist.githubusercontent.com/obeliskos/98a73205d7fe9746a687634e19a5eb89/raw/3821c9bbb6bae2689b00d16be9fae78dff430e28/destructuring%2520demo) and try various combinations of 'partitioned' and 'delimited' options (making sure both the serializeDestructured and deserializeDestructured use the same values.

Destructuring (making many smaller json serializations vs one large serialization) does not lower memory overhead but seems to be a little faster.  Partitioning can reduce memory overhead if you can dispose of those memory chunks before advancing to the next (which our adapter implementations do).  Our 2.0.0 branch which is able to use ES6 language constructs may gain an iterable interface in the future for data exchange or line-by-line streaming.

If your database is small enough you can use the LokiPartitioningAdapter (with or without paging) along with LokiMemoryAdapter to decompose database into appropriately sized 'chunks' for transmission.

# Detailed LokiIndexedDBAdapter Description

`LokiIndexedDBAdapter` is an 'incremental' mode loki persistence adapter: instead of a serialized string it receives the database through a function (`getLokiCopy`) and decides what to write.

It stores a database in an IndexedDB database named like the loki database (version 1), in an object store `LokiIncrementalData` of `{ key, value }` records, `value` being JSON text. The keys are `loki` (database properties and the version used to detect another writer), `<collection>.metadata` and `<collection>.chunk.<n>` (the documents whose `$loki` is between n*100 and n*100+99). Each loki database is therefore an IndexedDB database of its own, and the 'App' context, `getDatabaseList`, `getCatalogSummary` and `deleteDatabasePartitions` of `LokiIndexedAdapter` do not exist any more: `indexedDB.databases()` lists the databases of the origin, and `adapter.deleteDatabase(name)` deletes one.

A save opens one transaction, reads the stored version and, when it is the one this adapter last saved or loaded, writes only the dirty chunks and the metadata of the changed collections; otherwise (first save of an instance, other tab, collection removed or renamed) it writes everything and deletes the chunks that no collection owns any more. A save is all or nothing.

```javascript
import { Loki, LokiIndexedDBAdapter } from 'loki-ts';

const adapter = new LokiIndexedDBAdapter();
const db = await Loki.open('test', { adapter });
const coll = db.getCollection('testColl') ?? db.addCollection('testColl');
coll.insert({ test: 'val' });
await db.saveDatabase();

await adapter.deleteDatabase('test'); // deletes the IndexedDB database itself
```
