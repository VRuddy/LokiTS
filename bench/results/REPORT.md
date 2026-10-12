# LokiTS benchmarks

- node: 2026-10-12T22:03:56.606Z, commit `c581fea`, AMD Ryzen 5 5600H with Radeon Graphics (12 threads), 7 GB, linux 6.18.40.1-microsoft-standard-WSL2; node v22.23.3
- browser: 2026-10-12T21:37:20.024Z, commit `c581fea`, AMD Ryzen 5 5600H with Radeon Graphics (12 threads), 7 GB, linux 6.18.40.1-microsoft-standard-WSL2; chromium Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.8078.4 Safari/537.36, firefox Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0, webkit Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15

Reproduce: `pnpm install && pnpm build && pnpm bench && pnpm bench:browser && pnpm bench:report`

## Method

- Every engine runs in its fastest idiomatic configuration; the choices are listed under Engines.
- Same indexes everywhere: `id` (primary or unique key), `email` (unique), `age`; `city` and `score` are not indexed.
- Before measuring, every query is checked against LokiTS: an engine that answers differently is shown as an error, never compared.
- Node: every engine runs in its own child process, in three interleaved rounds (A, B, A, B…); the round with the median result is kept, since the JIT settles differently from one process to the next. Browsers: one page per engine, one round.
- Queries are measured with [mitata](https://github.com/evanwashere/mitata); bulk operations and persistence use one untimed setup per sample and a discarded warm-up sample.
- Durations are per operation. `remove-one` and `live-query` are averaged over 1000 operations per sample.
- `cold-start` runs with a warm OS file cache.
- With 5 samples (100,000 documents), p99 is the slowest sample.

## Limits

- Durability differs between engines (see Engines): a faster write may give fewer guarantees.
- SQLite WASM persistence runs in a Worker (OPFS SAH pool VFS), the other browser engines on the main thread.
- RxDB is measured in memory only: its fast persistent storages are not free.
- RxDB caches query results while the data does not change: `sort-limit` (always the same query) and the city queries (50 values) are mostly answered from that cache.
- SQLite `cold-start` opens the file and answers from disk without loading the data; the other engines load everything into memory first.
- Numbers depend on the machine; compare ratios, not absolute times.

## In-memory operations

### find-eq-indexed, 10,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 57.2 ns | 79.3 ns | 192 ns | ×0.73 |
| LokiTS | 78.1 ns | 99.7 ns | 252 ns | ×1.00 |
| lokijs | 87.5 ns | 108 ns | 254 ns | ×1.12 |
| TinyBase | 262 ns | 310 ns | 524 ns | ×3.35 |
| SQLite | 6.26 µs | 6.75 µs | 7.78 µs | ×80.16 |
| RxDB † | 6.52 µs | 9.14 µs | 80.6 µs | ×83.44 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-scan, 10,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 23.2 µs | 33 µs | 130 µs | ×0.07 |
| lokijs | 305 µs | 371 µs | 666 µs | ×0.98 |
| LokiTS | 310 µs | 381 µs | 680 µs | ×1.00 |
| LokiDB | 357 µs | 412 µs | 720 µs | ×1.15 |
| SQLite | 914 µs | 1.09 ms | 1.66 ms | ×2.95 |
| TinyBase | 7.66 ms | 9.05 ms | 13.2 ms | ×24.71 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-indexed, 10,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| TinyBase | 10.6 µs | 10.9 µs | 11.3 µs | ×0.89 |
| lokijs | 11.2 µs | 14.5 µs | 60.4 µs | ×0.94 |
| LokiTS | 11.9 µs | 15.9 µs | 79.9 µs | ×1.00 |
| LokiDB | 85.2 µs | 103 µs | 285 µs | ×7.13 |
| RxDB † | 101 µs | 139 µs | 1.29 ms | ×8.44 |
| SQLite | 879 µs | 1.03 ms | 1.74 ms | ×73.58 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-scan, 10,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 370 µs | 459 µs | 856 µs | ×0.63 |
| lokijs | 576 µs | 694 µs | 1.65 ms | ×0.98 |
| LokiTS | 588 µs | 722 µs | 1.9 ms | ×1.00 |
| SQLite | 747 µs | 879 µs | 1.41 ms | ×1.27 |
| RxDB † | 5.84 ms | 6.6 ms | 8.89 ms | ×9.93 |
| TinyBase | 6.44 ms | 7.18 ms | 12.6 ms | ×10.96 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-compound, 10,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiTS | 294 µs | 345 µs | 670 µs | ×1.00 |
| lokijs | 317 µs | 396 µs | 783 µs | ×1.08 |
| LokiDB | 339 µs | 402 µs | 694 µs | ×1.15 |
| SQLite | 2.06 ms | 2.67 ms | 4.07 ms | ×6.99 |
| RxDB † | 3.37 ms | 4.41 ms | 6.85 ms | ×11.46 |
| TinyBase | 7.05 ms | 8.3 ms | 11.9 ms | ×23.98 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### sort-limit, 10,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 4.85 µs | 6.94 µs | 27.5 µs | ×0.0003 |
| SQLite | 815 µs | 968 µs | 1.52 ms | ×0.06 |
| LokiDB | 4.59 ms | 5.09 ms | 6.55 ms | ×0.33 |
| TinyBase | 5.75 ms | 6.21 ms | 8.2 ms | ×0.41 |
| lokijs | 13.5 ms | 15.1 ms | 16.6 ms | ×0.97 |
| LokiTS | 13.9 ms | 15.4 ms | 17.4 ms | ×1.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### update-one, 10,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 687 ns | 933 ns | 2.77 µs | ×0.05 |
| SQLite | 2.07 µs | 2.26 µs | 2.75 µs | ×0.15 |
| TinyBase | 5.54 µs | 5.99 µs | 7.63 µs | ×0.41 |
| LokiTS | 13.5 µs | 15.5 µs | 61.6 µs | ×1.00 |
| lokijs | 15.9 µs | 17.4 µs | 61 µs | ×1.18 |
| RxDB † | 114 µs | 151 µs | 480 µs | ×8.43 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### insert-bulk, 10,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 7.66 ms | 8.34 ms | 9.51 ms | ×0.42 |
| LokiDB | 9.28 ms | 11 ms | 11.8 ms | ×0.50 |
| lokijs | 17.3 ms | 20.5 ms | 24.1 ms | ×0.94 |
| LokiTS | 18.4 ms | 20.9 ms | 22.6 ms | ×1.00 |
| SQLite | 38 ms | 41.8 ms | 44.8 ms | ×2.07 |
| TinyBase | 358 ms | 362 ms | 437 ms | ×19.41 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### remove-one, 10,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| SQLite | 7.23 µs | 8.16 µs | 9.08 µs | ×0.18 |
| LokiDB | 17.3 µs | 22.4 µs | 46 µs | ×0.44 |
| LokiTS | 39.5 µs | 40.2 µs | 44.4 µs | ×1.00 |
| lokijs | 41.2 µs | 44.3 µs | 54.1 µs | ×1.04 |
| TinyBase | 53 µs | 57.1 µs | 70.2 µs | ×1.34 |
| RxDB † | 168 µs | 180 µs | 193 µs | ×4.27 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### live-query, 10,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 5.58 µs | 5.89 µs | 6.49 µs | ×0.82 |
| lokijs | 6.23 µs | 7.08 µs | 8.17 µs | ×0.91 |
| LokiTS | 6.84 µs | 8.38 µs | 10.9 µs | ×1.00 |
| TinyBase | 98.8 µs | 111 µs | 125 µs | ×14.45 |
| RxDB † | 453 µs | 509 µs | 621 µs | ×66.31 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-indexed, 100,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiTS | 199 ns | 225 ns | 489 ns | ×1.00 |
| lokijs | 201 ns | 229 ns | 506 ns | ×1.01 |
| LokiDB | 241 ns | 274 ns | 647 ns | ×1.21 |
| TinyBase | 607 ns | 696 ns | 1.17 µs | ×3.04 |
| RxDB † | 7.16 µs | 8.69 µs | 71.7 µs | ×35.95 |
| SQLite | 7.89 µs | 7.99 µs | 8.63 µs | ×39.60 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-scan, 100,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| lokijs | 2.64 ms | 2.9 ms | 4.53 ms | ×0.96 |
| LokiTS | 2.76 ms | 3.13 ms | 4.34 ms | ×1.00 |
| LokiDB | 3.97 ms | 4.36 ms | 5.88 ms | ×1.44 |
| SQLite | 11.8 ms | 12.3 ms | 14.8 ms | ×4.29 |
| RxDB † | 29.5 ms | 33.1 ms | 36.4 ms | ×10.71 |
| TinyBase | 118 ms | 125 ms | 164 ms | ×42.85 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-indexed, 100,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| TinyBase | 207 µs | 263 µs | 1.06 ms | ×0.72 |
| lokijs | 278 µs | 503 µs | 1.2 ms | ×0.97 |
| LokiTS | 288 µs | 516 µs | 1.25 ms | ×1.00 |
| LokiDB | 1.36 ms | 1.59 ms | 2.82 ms | ×4.73 |
| SQLite | 11.6 ms | 12.3 ms | 14.3 ms | ×40.28 |
| RxDB † | 20.6 ms | 23 ms | 29.9 ms | ×71.59 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-scan, 100,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| lokijs | 3.97 ms | 4.53 ms | 6.01 ms | ×0.99 |
| LokiTS | 4.02 ms | 4.4 ms | 5.8 ms | ×1.00 |
| LokiDB | 4.33 ms | 4.79 ms | 6.27 ms | ×1.08 |
| SQLite | 10.3 ms | 11 ms | 12.2 ms | ×2.55 |
| RxDB † | 52.6 ms | 61.1 ms | 80.9 ms | ×13.07 |
| TinyBase | 102 ms | 109 ms | 154 ms | ×25.36 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-compound, 100,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| lokijs | 2.89 ms | 3.28 ms | 4.97 ms | ×0.99 |
| LokiTS | 2.92 ms | 3.28 ms | 4.93 ms | ×1.00 |
| LokiDB | 4.3 ms | 4.85 ms | 6.84 ms | ×1.47 |
| RxDB † | 33.2 ms | 50.1 ms | 67.8 ms | ×11.37 |
| SQLite | 54.2 ms | 67 ms | 74.1 ms | ×18.56 |
| TinyBase | 107 ms | 124 ms | 134 ms | ×36.60 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### sort-limit, 100,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 4.68 µs | 5.88 µs | 21.3 µs | ×0.00002 |
| SQLite | 9.56 ms | 10.3 ms | 12.9 ms | ×0.04 |
| TinyBase | 126 ms | 135 ms | 146 ms | ×0.47 |
| LokiDB | 134 ms | 138 ms | 142 ms | ×0.50 |
| lokijs | 253 ms | 267 ms | 284 ms | ×0.94 |
| LokiTS | 269 ms | 284 ms | 292 ms | ×1.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### update-one, 100,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 2.57 µs | 2.71 µs | 3.51 µs | ×0.02 |
| SQLite | 2.78 µs | 2.97 µs | 3.49 µs | ×0.02 |
| TinyBase | 5.57 µs | 6.02 µs | 6.54 µs | ×0.04 |
| LokiTS | 127 µs | 163 µs | 346 µs | ×1.00 |
| RxDB † | 135 µs | 265 µs | 750 µs | ×1.06 |
| lokijs | 155 µs | 190 µs | 419 µs | ×1.21 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### insert-bulk, 100,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 142 ms | 144 ms | 161 ms | ×0.13 |
| LokiDB | 155 ms | 159 ms | 165 ms | ×0.14 |
| SQLite | 444 ms | 460 ms | 466 ms | ×0.41 |
| lokijs | 1.07 s | 1.07 s | 1.18 s | ×0.98 |
| LokiTS | 1.09 s | 1.09 s | 1.11 s | ×1.00 |
| TinyBase | 3.64 s | 3.68 s | 3.77 s | ×3.35 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### remove-one, 100,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| SQLite | 13 µs | 13.2 µs | 13.3 µs | ×0.03 |
| TinyBase | 66 µs | 71.1 µs | 72 µs | ×0.17 |
| LokiDB | 135 µs | 139 µs | 143 µs | ×0.35 |
| lokijs | 377 µs | 378 µs | 380 µs | ×0.99 |
| LokiTS | 382 µs | 385 µs | 396 µs | ×1.00 |
| RxDB † | 985 µs | 999 µs | 1.11 ms | ×2.58 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### live-query, 100,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 3.43 µs | 3.86 µs | 4.04 µs | ×0.07 |
| lokijs | 48.4 µs | 54.6 µs | 73.2 µs | ×0.95 |
| LokiTS | 51.3 µs | 53.8 µs | 57.8 µs | ×1.00 |
| TinyBase | 107 µs | 110 µs | 117 µs | ×2.09 |
| RxDB † | 3.73 ms | 3.8 ms | 3.88 ms | ×72.72 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-indexed, 10,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 0 ns | 0 ns | 100 µs | ×0 |
| SQLite | 0 ns | 100 µs | 300 µs | ×0 |
| lokijs | 73.2 ns | 97.7 ns | 244 ns | ×1.00 |
| LokiTS | 73.2 ns | 97.7 ns | 220 ns | ×1.00 |
| LokiDB | 97.7 ns | 146 ns | 415 ns | ×1.33 |
| TinyBase | 293 ns | 317 ns | 879 ns | ×4.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-scan, 10,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 0 ns | 0 ns | 200 µs | ×0 |
| lokijs | 300 µs | 400 µs | 800 µs | ×0.75 |
| LokiTS | 400 µs | 500 µs | 1.1 ms | ×1.00 |
| LokiDB | 600 µs | 700 µs | 1.8 ms | ×1.50 |
| TinyBase | 5.3 ms | 6 ms | 8.1 ms | ×13.25 |
| SQLite | 6.8 ms | 7.5 ms | 10.1 ms | ×17.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-indexed, 10,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| lokijs | 0 ns | 0 ns | 100 µs | ×NaN |
| LokiTS | 0 ns | 0 ns | 200 µs | ×NaN |
| TinyBase | 7.57 µs | 8.35 µs | 9.47 µs | ×Infinity |
| RxDB † | 100 µs | 200 µs | 1.2 ms | ×Infinity |
| LokiDB | 100 µs | 200 µs | 600 µs | ×Infinity |
| SQLite | 12.2 ms | 13.7 ms | 17 ms | ×Infinity |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-scan, 10,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| lokijs | 300 µs | 400 µs | 800 µs | ×0.60 |
| LokiDB | 500 µs | 600 µs | 1.2 ms | ×1.00 |
| LokiTS | 500 µs | 600 µs | 1 ms | ×1.00 |
| RxDB † | 3.6 ms | 4.2 ms | 6.1 ms | ×7.20 |
| SQLite | 3.8 ms | 4.6 ms | 6.9 ms | ×7.60 |
| TinyBase | 4.9 ms | 5.8 ms | 8.5 ms | ×9.80 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-compound, 10,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| lokijs | 300 µs | 400 µs | 600 µs | ×0.75 |
| LokiTS | 400 µs | 500 µs | 800 µs | ×1.00 |
| LokiDB | 600 µs | 700 µs | 1.4 ms | ×1.50 |
| RxDB † | 2.3 ms | 3.1 ms | 6.9 ms | ×5.75 |
| TinyBase | 5 ms | 6.9 ms | 13.2 ms | ×12.50 |
| SQLite | 8.7 ms | 11.5 ms | 18.6 ms | ×21.75 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### sort-limit, 10,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 0 ns | 0 ns | 100 µs | ×0 |
| SQLite | 2.8 ms | 3.2 ms | 5.4 ms | ×0.17 |
| TinyBase | 3.6 ms | 4.2 ms | 7.8 ms | ×0.22 |
| LokiDB | 6.9 ms | 8.6 ms | 14 ms | ×0.43 |
| lokijs | 10.8 ms | 12.4 ms | 16.7 ms | ×0.67 |
| LokiTS | 16.1 ms | 17.9 ms | 20.3 ms | ×1.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### update-one, 10,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| lokijs | 0 ns | 0 ns | 100 µs | ×NaN |
| LokiTS | 0 ns | 100 µs | 200 µs | ×NaN |
| SQLite | 0 ns | 0 ns | 100 µs | ×NaN |
| TinyBase | 0 ns | 0 ns | 100 µs | ×NaN |
| LokiDB | 830 ns | 1.05 µs | 2.47 µs | ×Infinity |
| RxDB † | 100 µs | 200 µs | 700 µs | ×Infinity |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### insert-bulk, 10,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 7.6 ms | 8.7 ms | 31.1 ms | ×0.47 |
| LokiDB | 7.9 ms | 9 ms | 12.4 ms | ×0.49 |
| LokiTS | 16.2 ms | 16.6 ms | 37.2 ms | ×1.00 |
| lokijs | 17.4 ms | 19.2 ms | 40.8 ms | ×1.07 |
| TinyBase | 349 ms | 425 ms | 948 ms | ×21.55 |
| SQLite | 415 ms | 637 ms | 847 ms | ×25.60 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### remove-one, 10,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 4.7 µs | 5.5 µs | 11.4 µs | ×0.17 |
| SQLite | 14 µs | 15.6 µs | 17.7 µs | ×0.50 |
| LokiTS | 27.8 µs | 34 µs | 45.7 µs | ×1.00 |
| TinyBase | 33.8 µs | 50.3 µs | 408 µs | ×1.22 |
| lokijs | 35.6 µs | 37.8 µs | 54.4 µs | ×1.28 |
| RxDB † | 172 µs | 197 µs | 234 µs | ×6.17 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### live-query, 10,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 2.9 µs | 4.1 µs | 37 µs | ×0.66 |
| LokiTS | 4.4 µs | 6.1 µs | 25.7 µs | ×1.00 |
| lokijs | 5 µs | 5.4 µs | 7.1 µs | ×1.14 |
| TinyBase | 59.7 µs | 69.1 µs | 92 µs | ×13.57 |
| RxDB † | 507 µs | 539 µs | 598 µs | ×115.32 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-indexed, 100,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 0 ns | 0 ns | 200 µs | ×0 |
| LokiDB | 195 ns | 220 ns | 513 ns | ×0.80 |
| lokijs | 220 ns | 244 ns | 684 ns | ×0.90 |
| LokiTS | 244 ns | 269 ns | 684 ns | ×1.00 |
| TinyBase | 488 ns | 586 ns | 1.61 µs | ×2.00 |
| SQLite | 36.6 µs | 38.7 µs | 57.9 µs | ×149.80 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-scan, 100,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiTS | 4 ms | 4.6 ms | 8.4 ms | ×1.00 |
| LokiDB | 5.1 ms | 5.9 ms | 7.9 ms | ×1.27 |
| lokijs | 10.1 ms | 11.6 ms | 15.6 ms | ×2.53 |
| RxDB † | 22.5 ms | 25.8 ms | 45.4 ms | ×5.63 |
| SQLite | 67.6 ms | 73.7 ms | 198 ms | ×16.90 |
| TinyBase | 79 ms | 85.4 ms | 109 ms | ×19.75 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-indexed, 100,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| lokijs | 400 µs | 500 µs | 1.1 ms | ×0.67 |
| TinyBase | 400 µs | 400 µs | 1.7 ms | ×0.67 |
| LokiTS | 600 µs | 800 µs | 1.4 ms | ×1.00 |
| LokiDB | 1.2 ms | 1.4 ms | 2.4 ms | ×2.00 |
| RxDB † | 21.3 ms | 27.3 ms | 45.2 ms | ×35.50 |
| SQLite | 133 ms | 144 ms | 210 ms | ×222.17 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-scan, 100,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiTS | 4.7 ms | 5.6 ms | 8.2 ms | ×1.00 |
| LokiDB | 5 ms | 5.6 ms | 6.7 ms | ×1.06 |
| lokijs | 17 ms | 18.3 ms | 19.3 ms | ×3.62 |
| RxDB † | 31.2 ms | 37 ms | 40.4 ms | ×6.64 |
| SQLite | 38.3 ms | 41.3 ms | 42.6 ms | ×8.15 |
| TinyBase | 91.3 ms | 104 ms | 163 ms | ×19.43 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-compound, 100,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiTS | 4.2 ms | 4.9 ms | 6.4 ms | ×1.00 |
| LokiDB | 5 ms | 5.9 ms | 7.2 ms | ×1.19 |
| lokijs | 8.8 ms | 10.1 ms | 13.4 ms | ×2.10 |
| RxDB † | 28.7 ms | 54 ms | 61.8 ms | ×6.83 |
| TinyBase | 123 ms | 173 ms | 184 ms | ×29.38 |
| SQLite | 138 ms | 169 ms | 203 ms | ×32.79 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### sort-limit, 100,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 0 ns | 0 ns | 100 µs | ×0 |
| SQLite | 19.3 ms | 20.9 ms | 23.3 ms | ×0.05 |
| LokiDB | 140 ms | 161 ms | 178 ms | ×0.39 |
| TinyBase | 179 ms | 189 ms | 235 ms | ×0.49 |
| lokijs | 307 ms | 320 ms | 441 ms | ×0.85 |
| LokiTS | 361 ms | 440 ms | 559 ms | ×1.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### update-one, 100,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| SQLite | 0 ns | 0 ns | 100 µs | ×0 |
| LokiDB | 2.78 µs | 3.47 µs | 5.91 µs | ×0.01 |
| TinyBase | 6.88 µs | 7.52 µs | 10.2 µs | ×0.03 |
| lokijs | 200 µs | 200 µs | 500 µs | ×1.00 |
| LokiTS | 200 µs | 300 µs | 700 µs | ×1.00 |
| RxDB † | 600 µs | 800 µs | 6.9 ms | ×3.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### insert-bulk, 100,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 195 ms | 207 ms | 221 ms | ×0.21 |
| RxDB † | 211 ms | 446 ms | 818 ms | ×0.22 |
| lokijs | 751 ms | 821 ms | 1.11 s | ×0.79 |
| LokiTS | 947 ms | 1.24 s | 1.43 s | ×1.00 |
| SQLite | 3.35 s | 9.09 s | 11.2 s | ×3.54 |
| TinyBase | 3.78 s | 3.79 s | 4.04 s | ×3.99 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### remove-one, 100,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| SQLite | 21.8 µs | 23.8 µs | 32.9 µs | ×0.05 |
| LokiDB | 38.5 µs | 214 µs | 585 µs | ×0.10 |
| TinyBase | 51.1 µs | 60.5 µs | 75.5 µs | ×0.13 |
| lokijs | 309 µs | 324 µs | 755 µs | ×0.77 |
| LokiTS | 403 µs | 800 µs | 815 µs | ×1.00 |
| RxDB † | 2.72 ms | 4.18 ms | 4.71 ms | ×6.75 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### live-query, 100,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 1.8 µs | 2.3 µs | 44.9 µs | ×0.20 |
| LokiTS | 9.2 µs | 48.4 µs | 98.9 µs | ×1.00 |
| lokijs | 9.3 µs | 11 µs | 58.1 µs | ×1.01 |
| TinyBase | 75.7 µs | 77.8 µs | 85.7 µs | ×8.23 |
| RxDB † | 3.6 ms | 3.72 ms | 5.4 ms | ×391.50 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-indexed, 10,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 0 ns | 0 ns | 1 ms | ×0 |
| LokiDB | 244 ns | 244 ns | 488 ns | ×1.00 |
| lokijs | 244 ns | 244 ns | 732 ns | ×1.00 |
| LokiTS | 244 ns | 244 ns | 488 ns | ×1.00 |
| TinyBase | 488 ns | 488 ns | 977 ns | ×2.00 |
| SQLite | 39.6 µs | 42 µs | 65.4 µs | ×162.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-scan, 10,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 0 ns | 1 ms | 1 ms | ×NaN |
| lokijs | 0 ns | 0 ns | 2 ms | ×NaN |
| LokiTS | 0 ns | 0 ns | 1 ms | ×NaN |
| RxDB † | 0 ns | 0 ns | 5 ms | ×NaN |
| SQLite | 6 ms | 7 ms | 10 ms | ×Infinity |
| TinyBase | 13 ms | 15 ms | 26 ms | ×Infinity |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-indexed, 10,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 0 ns | 0 ns | 1 ms | ×NaN |
| lokijs | 0 ns | 0 ns | 1 ms | ×NaN |
| LokiTS | 0 ns | 0 ns | 1 ms | ×NaN |
| RxDB † | 0 ns | 1 ms | 3 ms | ×NaN |
| TinyBase | 0 ns | 0 ns | 1 ms | ×NaN |
| SQLite | 14 ms | 15 ms | 19 ms | ×Infinity |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-scan, 10,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 0 ns | 0 ns | 1 ms | ×NaN |
| LokiTS | 0 ns | 1 ms | 2 ms | ×NaN |
| lokijs | 1 ms | 1 ms | 2 ms | ×Infinity |
| SQLite | 5 ms | 6 ms | 9 ms | ×Infinity |
| RxDB † | 6 ms | 7 ms | 10 ms | ×Infinity |
| TinyBase | 14 ms | 15 ms | 19 ms | ×Infinity |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-compound, 10,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 0 ns | 1 ms | 2 ms | ×NaN |
| lokijs | 0 ns | 1 ms | 2 ms | ×NaN |
| LokiTS | 0 ns | 0 ns | 1 ms | ×NaN |
| RxDB † | 6 ms | 8 ms | 14 ms | ×Infinity |
| SQLite | 6 ms | 8 ms | 11 ms | ×Infinity |
| TinyBase | 15 ms | 17 ms | 22 ms | ×Infinity |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### sort-limit, 10,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 0 ns | 0 ns | 1 ms | ×0 |
| SQLite | 2 ms | 3 ms | 4 ms | ×0.09 |
| LokiDB | 7 ms | 8 ms | 11 ms | ×0.30 |
| TinyBase | 9 ms | 11 ms | 29 ms | ×0.39 |
| LokiTS | 23 ms | 24 ms | 27 ms | ×1.00 |
| lokijs | 32 ms | 36 ms | 56 ms | ×1.39 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### update-one, 10,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiTS | 0 ns | 0 ns | 1 ms | ×NaN |
| SQLite | 0 ns | 0 ns | 0 ns | ×NaN |
| TinyBase | 0 ns | 0 ns | 0 ns | ×NaN |
| LokiDB | 977 ns | 1.46 µs | 1.95 µs | ×Infinity |
| lokijs | 23.2 µs | 25.1 µs | 28.3 µs | ×Infinity |
| RxDB † | 1 ms | 1 ms | 2 ms | ×Infinity |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### insert-bulk, 10,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 24 ms | 27 ms | 31 ms | ×0.53 |
| RxDB † | 27 ms | 33 ms | 47 ms | ×0.60 |
| LokiTS | 45 ms | 49 ms | 79 ms | ×1.00 |
| lokijs | 51 ms | 66 ms | 82 ms | ×1.13 |
| SQLite | 226 ms | 240 ms | 370 ms | ×5.02 |
| TinyBase | 551 ms | 568 ms | 640 ms | ×12.24 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### remove-one, 10,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 10 µs | 16 µs | 28 µs | ×0.29 |
| SQLite | 16 µs | 18 µs | 35 µs | ×0.47 |
| LokiTS | 34 µs | 37 µs | 40 µs | ×1.00 |
| lokijs | 43 µs | 47 µs | 52 µs | ×1.26 |
| TinyBase | 64 µs | 68 µs | 75 µs | ×1.88 |
| RxDB † | 634 µs | 716 µs | 3.97 ms | ×18.65 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### live-query, 10,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 4 µs | 9 µs | 18 µs | ×0.57 |
| LokiTS | 7 µs | 12 µs | 14 µs | ×1.00 |
| lokijs | 9 µs | 13 µs | 21 µs | ×1.29 |
| TinyBase | 101 µs | 114 µs | 150 µs | ×14.43 |
| RxDB † | 934 µs | 1.15 ms | 5.8 ms | ×133.43 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-indexed, 100,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| lokijs | 0 ns | 0 ns | 0 ns | ×0 |
| RxDB † | 0 ns | 0 ns | 1 ms | ×0 |
| LokiDB | 488 ns | 732 ns | 1.46 µs | ×1.00 |
| LokiTS | 488 ns | 488 ns | 732 ns | ×1.00 |
| TinyBase | 977 ns | 1.22 µs | 2.69 µs | ×2.00 |
| SQLite | 46.6 µs | 49.1 µs | 57.6 µs | ×95.50 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-scan, 100,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiTS | 3 ms | 4 ms | 8 ms | ×1.00 |
| LokiDB | 4 ms | 6 ms | 15 ms | ×1.33 |
| lokijs | 5 ms | 6 ms | 8 ms | ×1.67 |
| RxDB † | 34 ms | 40 ms | 45 ms | ×11.33 |
| SQLite | 81 ms | 84 ms | 93 ms | ×27.00 |
| TinyBase | 168 ms | 174 ms | 201 ms | ×56.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-indexed, 100,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiTS | 0 ns | 1 ms | 1 ms | ×NaN |
| lokijs | 1 ms | 1 ms | 2 ms | ×Infinity |
| TinyBase | 1 ms | 1 ms | 2 ms | ×Infinity |
| LokiDB | 2 ms | 3 ms | 5 ms | ×Infinity |
| RxDB † | 31 ms | 33 ms | 44 ms | ×Infinity |
| SQLite | 172 ms | 183 ms | 199 ms | ×Infinity |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-scan, 100,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 5 ms | 5 ms | 7 ms | ×1.00 |
| LokiTS | 5 ms | 6 ms | 8 ms | ×1.00 |
| lokijs | 8 ms | 9 ms | 11 ms | ×1.60 |
| SQLite | 50 ms | 53 ms | 54 ms | ×10.00 |
| RxDB † | 85 ms | 98 ms | 125 ms | ×17.00 |
| TinyBase | 153 ms | 160 ms | 180 ms | ×30.60 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-compound, 100,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiTS | 4 ms | 4 ms | 6 ms | ×1.00 |
| LokiDB | 6 ms | 6 ms | 7 ms | ×1.50 |
| lokijs | 6 ms | 7 ms | 9 ms | ×1.50 |
| RxDB † | 93 ms | 119 ms | 130 ms | ×23.25 |
| SQLite | 124 ms | 186 ms | 233 ms | ×31.00 |
| TinyBase | 166 ms | 180 ms | 202 ms | ×41.50 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### sort-limit, 100,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 0 ns | 0 ns | 1 ms | ×0 |
| SQLite | 20 ms | 21 ms | 23 ms | ×0.04 |
| TinyBase | 179 ms | 188 ms | 198 ms | ×0.40 |
| LokiDB | 276 ms | 283 ms | 339 ms | ×0.61 |
| LokiTS | 452 ms | 473 ms | 505 ms | ×1.00 |
| lokijs | 543 ms | 578 ms | 733 ms | ×1.20 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### update-one, 100,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| lokijs | 0 ns | 0 ns | 1 ms | ×NaN |
| LokiTS | 0 ns | 0 ns | 1 ms | ×NaN |
| SQLite | 0 ns | 0 ns | 1 ms | ×NaN |
| LokiDB | 2.93 µs | 3.17 µs | 3.42 µs | ×Infinity |
| TinyBase | 6.1 µs | 6.35 µs | 6.84 µs | ×Infinity |
| RxDB † | 1 ms | 1 ms | 2 ms | ×Infinity |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### insert-bulk, 100,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 234 ms | 287 ms | 440 ms | ×0.11 |
| LokiDB | 364 ms | 365 ms | 621 ms | ×0.17 |
| LokiTS | 2.17 s | 2.19 s | 2.2 s | ×1.00 |
| SQLite | 2.4 s | 2.51 s | 2.74 s | ×1.11 |
| lokijs | 2.91 s | 2.98 s | 5.72 s | ×1.34 |
| TinyBase | 5.85 s | 5.93 s | 6.05 s | ×2.70 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### remove-one, 100,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| SQLite | 18 µs | 20 µs | 20 µs | ×0.05 |
| TinyBase | 72 µs | 78 µs | 84 µs | ×0.21 |
| LokiDB | 73 µs | 125 µs | 141 µs | ×0.21 |
| LokiTS | 343 µs | 344 µs | 362 µs | ×1.00 |
| lokijs | 371 µs | 390 µs | 680 µs | ×1.08 |
| RxDB † | 2.77 ms | 3.01 ms | 3.98 ms | ×8.07 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### live-query, 100,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 6 µs | 6 µs | 6 µs | ×0.14 |
| LokiTS | 44 µs | 46 µs | 48 µs | ×1.00 |
| lokijs | 48 µs | 51 µs | 53 µs | ×1.09 |
| TinyBase | 100 µs | 128 µs | 132 µs | ×2.27 |
| RxDB † | 7.04 ms | 7.3 ms | 8.18 ms | ×159.91 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-indexed, 10,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 0 ns | 244 ns | 244 ns | ×0 |
| lokijs | 0 ns | 244 ns | 244 ns | ×0 |
| RxDB † | 0 ns | 0 ns | 1 ms | ×0 |
| SQLite | 0 ns | 0 ns | 1 ms | ×0 |
| LokiTS | 244 ns | 244 ns | 977 ns | ×1.00 |
| TinyBase | 732 ns | 977 ns | 1.71 µs | ×3.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-scan, 10,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 0 ns | 0 ns | 1 ms | ×0 |
| RxDB † | 0 ns | 0 ns | 2 ms | ×0 |
| lokijs | 151 µs | 155 µs | 161 µs | ×0.81 |
| LokiTS | 186 µs | 196 µs | 239 µs | ×1.00 |
| SQLite | 8 ms | 9 ms | 11 ms | ×43.06 |
| TinyBase | 15 ms | 16 ms | 22 ms | ×80.74 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-indexed, 10,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 0 ns | 1 ms | 3 ms | ×0 |
| lokijs | 19.5 µs | 20.3 µs | 31 µs | ×0.68 |
| LokiTS | 28.8 µs | 31.5 µs | 36.1 µs | ×1.00 |
| LokiDB | 107 µs | 117 µs | 134 µs | ×3.73 |
| TinyBase | 164 µs | 276 µs | 573 µs | ×5.68 |
| SQLite | 20 ms | 21 ms | 24 ms | ×694.24 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-scan, 10,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 0 ns | 0 ns | 1 ms | ×0 |
| lokijs | 1 ms | 2 ms | 4 ms | ×1.00 |
| LokiTS | 1 ms | 2 ms | 4 ms | ×1.00 |
| RxDB † | 3 ms | 4 ms | 6 ms | ×3.00 |
| SQLite | 5 ms | 6 ms | 7 ms | ×5.00 |
| TinyBase | 15 ms | 17 ms | 22 ms | ×15.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-compound, 10,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| lokijs | 0 ns | 0 ns | 1 ms | ×NaN |
| LokiTS | 0 ns | 1 ms | 1 ms | ×NaN |
| LokiDB | 196 µs | 198 µs | 215 µs | ×Infinity |
| RxDB † | 3 ms | 5 ms | 15 ms | ×Infinity |
| SQLite | 8 ms | 11 ms | 14 ms | ×Infinity |
| TinyBase | 18 ms | 20 ms | 30 ms | ×Infinity |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### sort-limit, 10,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 0 ns | 0 ns | 1 ms | ×0 |
| SQLite | 3 ms | 3 ms | 5 ms | ×0.09 |
| LokiDB | 4 ms | 5 ms | 7 ms | ×0.12 |
| TinyBase | 7 ms | 8 ms | 11 ms | ×0.21 |
| lokijs | 27 ms | 31 ms | 34 ms | ×0.79 |
| LokiTS | 34 ms | 36 ms | 39 ms | ×1.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### update-one, 10,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 0 ns | 0 ns | 0 ns | ×NaN |
| lokijs | 0 ns | 0 ns | 0 ns | ×NaN |
| LokiTS | 0 ns | 0 ns | 1 ms | ×NaN |
| RxDB † | 0 ns | 0 ns | 2 ms | ×NaN |
| SQLite | 0 ns | 0 ns | 0 ns | ×NaN |
| TinyBase | 0 ns | 0 ns | 0 ns | ×NaN |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### insert-bulk, 10,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 8 ms | 11 ms | 52 ms | ×0.28 |
| LokiDB | 9 ms | 13 ms | 26 ms | ×0.31 |
| lokijs | 18 ms | 25 ms | 29 ms | ×0.62 |
| LokiTS | 29 ms | 33 ms | 39 ms | ×1.00 |
| SQLite | 272 ms | 280 ms | 317 ms | ×9.38 |
| TinyBase | 396 ms | 405 ms | 471 ms | ×13.66 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### remove-one, 10,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 7 µs | 7 µs | 10 µs | ×0.24 |
| SQLite | 16 µs | 19 µs | 26 µs | ×0.55 |
| lokijs | 22 µs | 24 µs | 25 µs | ×0.76 |
| LokiTS | 29 µs | 32 µs | 92 µs | ×1.00 |
| TinyBase | 41 µs | 52 µs | 54 µs | ×1.41 |
| RxDB † | 221 µs | 355 µs | 1.16 ms | ×7.62 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### live-query, 10,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 2 µs | 3 µs | 5 µs | ×0.50 |
| lokijs | 3 µs | 4 µs | 6 µs | ×0.75 |
| LokiTS | 4 µs | 8 µs | 27 µs | ×1.00 |
| TinyBase | 66 µs | 83 µs | 98 µs | ×16.50 |
| RxDB † | 474 µs | 539 µs | 648 µs | ×118.50 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-indexed, 100,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 0 ns | 0 ns | 1 ms | ×0 |
| LokiDB | 244 ns | 488 ns | 488 ns | ×1.00 |
| lokijs | 244 ns | 244 ns | 488 ns | ×1.00 |
| LokiTS | 244 ns | 244 ns | 488 ns | ×1.00 |
| TinyBase | 2.44 µs | 2.69 µs | 3.17 µs | ×10.00 |
| SQLite | 53.7 µs | 59.8 µs | 69.6 µs | ×220.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-eq-scan, 100,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 3 ms | 3 ms | 5 ms | ×1.00 |
| lokijs | 3 ms | 3 ms | 4 ms | ×1.00 |
| LokiTS | 3 ms | 3 ms | 5 ms | ×1.00 |
| RxDB † | 24 ms | 29 ms | 36 ms | ×8.00 |
| SQLite | 84 ms | 107 ms | 129 ms | ×28.00 |
| TinyBase | 219 ms | 263 ms | 669 ms | ×73.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-indexed, 100,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| lokijs | 1 ms | 1 ms | 1 ms | ×1.00 |
| LokiTS | 1 ms | 1 ms | 2 ms | ×1.00 |
| LokiDB | 2 ms | 3 ms | 7 ms | ×2.00 |
| TinyBase | 4 ms | 9 ms | 23 ms | ×4.00 |
| RxDB † | 26 ms | 29 ms | 32 ms | ×26.00 |
| SQLite | 173 ms | 186 ms | 218 ms | ×173.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-range-scan, 100,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 3 ms | 3 ms | 4 ms | ×0.18 |
| lokijs | 12 ms | 14 ms | 16 ms | ×0.71 |
| LokiTS | 17 ms | 21 ms | 25 ms | ×1.00 |
| RxDB † | 41 ms | 44 ms | 77 ms | ×2.41 |
| SQLite | 42 ms | 47 ms | 54 ms | ×2.47 |
| TinyBase | 165 ms | 179 ms | 208 ms | ×9.71 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### find-compound, 100,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 3 ms | 4 ms | 5 ms | ×0.75 |
| lokijs | 3 ms | 3 ms | 4 ms | ×0.75 |
| LokiTS | 4 ms | 5 ms | 13 ms | ×1.00 |
| RxDB † | 30 ms | 45 ms | 63 ms | ×7.50 |
| SQLite | 145 ms | 193 ms | 255 ms | ×36.25 |
| TinyBase | 165 ms | 190 ms | 328 ms | ×41.25 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### sort-limit, 100,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 0 ns | 0 ns | 1 ms | ×0 |
| SQLite | 23 ms | 24 ms | 27 ms | ×0.05 |
| LokiDB | 98 ms | 105 ms | 124 ms | ×0.21 |
| TinyBase | 120 ms | 140 ms | 263 ms | ×0.26 |
| lokijs | 418 ms | 456 ms | 484 ms | ×0.91 |
| LokiTS | 461 ms | 553 ms | 631 ms | ×1.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### update-one, 100,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 0 ns | 0 ns | 0 ns | ×NaN |
| lokijs | 0 ns | 0 ns | 1 ms | ×NaN |
| LokiTS | 0 ns | 0 ns | 1 ms | ×NaN |
| RxDB † | 0 ns | 0 ns | 1 ms | ×NaN |
| SQLite | 0 ns | 0 ns | 1 ms | ×NaN |
| TinyBase | 0 ns | 0 ns | 0 ns | ×NaN |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### insert-bulk, 100,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| RxDB † | 90 ms | 98 ms | 100 ms | ×0.08 |
| LokiDB | 101 ms | 123 ms | 127 ms | ×0.09 |
| lokijs | 949 ms | 993 ms | 1.04 s | ×0.88 |
| LokiTS | 1.08 s | 1.09 s | 1.14 s | ×1.00 |
| SQLite | 2.97 s | 3.04 s | 3.18 s | ×2.74 |
| TinyBase | 3.93 s | 4.17 s | 4.2 s | ×3.63 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### remove-one, 100,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| SQLite | 18 µs | 23 µs | 25 µs | ×0.09 |
| LokiDB | 34 µs | 35 µs | 37 µs | ×0.17 |
| TinyBase | 45 µs | 48 µs | 57 µs | ×0.23 |
| lokijs | 176 µs | 193 µs | 250 µs | ×0.89 |
| LokiTS | 198 µs | 200 µs | 223 µs | ×1.00 |
| RxDB † | 846 µs | 863 µs | 1.11 ms | ×4.27 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

### live-query, 100,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS |
|---|---|---|---|---|
| LokiDB | 2 µs | 3 µs | 3 µs | ×0.13 |
| lokijs | 11 µs | 11 µs | 11 µs | ×0.73 |
| LokiTS | 15 µs | 16 µs | 23 µs | ×1.00 |
| TinyBase | 67 µs | 89 µs | 123 µs | ×4.47 |
| RxDB † | 4.3 ms | 4.49 ms | 6 ms | ×287.00 |

† RxDB may answer repeated queries from its query cache while the data does not change (see Limits).

## Persistence

### write-all, 10,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS (fs) |
|---|---|---|---|---|
| LokiDB (fs) | 27.3 ms | 30 ms | 32.2 ms | ×0.26 |
| SQLite (file) | 54.3 ms | 60.9 ms | 69.3 ms | ×0.53 |
| lokijs (fs) | 56.5 ms | 59.7 ms | 66.8 ms | ×0.55 |
| LokiTS (fs) | 103 ms | 151 ms | 170 ms | ×1.00 |
| LokiTS (fs-structured) | 134 ms | 152 ms | 241 ms | ×1.30 |
| TinyBase (file) | 382 ms | 418 ms | 428 ms | ×3.71 |

### write-delta, 10,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS (fs) |
|---|---|---|---|---|
| SQLite (file) | 15.7 ms | 16 ms | 16.3 ms | ×0.17 |
| LokiDB (fs) | 20 ms | 21.7 ms | 23.9 ms | ×0.22 |
| lokijs (fs) | 45 ms | 48.5 ms | 54.7 ms | ×0.48 |
| TinyBase (file) | 72.2 ms | 79.2 ms | 99.3 ms | ×0.78 |
| LokiTS (fs) | 92.9 ms | 101 ms | 109 ms | ×1.00 |
| LokiTS (fs-structured) | 123 ms | 147 ms | 160 ms | ×1.33 |

### cold-start, 10,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS (fs) |
|---|---|---|---|---|
| SQLite (file) | 855 µs | 961 µs | 1.3 ms | ×0.03 |
| lokijs (fs) | 28 ms | 29.6 ms | 30.7 ms | ×0.90 |
| LokiTS (fs) | 30.9 ms | 33.6 ms | 35.4 ms | ×1.00 |
| LokiDB (fs) | 33.6 ms | 36.1 ms | 39.3 ms | ×1.09 |
| LokiTS (fs-structured) | 38.9 ms | 40.4 ms | 42.5 ms | ×1.26 |
| TinyBase (file) | 277 ms | 281 ms | 284 ms | ×8.96 |

### write-all, 100,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS (fs) |
|---|---|---|---|---|
| LokiDB (fs) | 319 ms | 331 ms | 343 ms | ×0.17 |
| SQLite (file) | 971 ms | 995 ms | 1.06 s | ×0.50 |
| lokijs (fs) | 1.39 s | 1.42 s | 1.51 s | ×0.72 |
| LokiTS (fs-structured) | 1.82 s | 1.84 s | 1.9 s | ×0.94 |
| LokiTS (fs) | 1.93 s | 2.01 s | 2.03 s | ×1.00 |
| TinyBase (file) | 4.14 s | 4.15 s | 4.35 s | ×2.15 |

### write-delta, 100,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS (fs) |
|---|---|---|---|---|
| SQLite (file) | 27.6 ms | 46.2 ms | 50.9 ms | ×0.03 |
| LokiDB (fs) | 211 ms | 215 ms | 224 ms | ×0.21 |
| lokijs (fs) | 490 ms | 504 ms | 550 ms | ×0.48 |
| LokiTS (fs-structured) | 603 ms | 679 ms | 859 ms | ×0.59 |
| TinyBase (file) | 811 ms | 868 ms | 890 ms | ×0.80 |
| LokiTS (fs) | 1.02 s | 1.06 s | 1.23 s | ×1.00 |

### cold-start, 100,000 documents, node

| Engine | Median | p75 | p99 | vs LokiTS (fs) |
|---|---|---|---|---|
| SQLite (file) | 1.07 ms | 1.14 ms | 1.18 ms | ×0.003 |
| lokijs (fs) | 344 ms | 346 ms | 354 ms | ×0.95 |
| LokiTS (fs) | 362 ms | 372 ms | 381 ms | ×1.00 |
| LokiDB (fs) | 372 ms | 373 ms | 407 ms | ×1.03 |
| LokiTS (fs-structured) | 440 ms | 446 ms | 453 ms | ×1.22 |
| TinyBase (file) | 2.91 s | 2.99 s | 3.03 s | ×8.03 |

### write-all, 10,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| lokijs (indexeddb) | 52.5 ms | 58.5 ms | 63.8 ms | ×0.96 |
| LokiTS (indexeddb) | 54.7 ms | 58.6 ms | 62 ms | ×1.00 |
| LokiTS (opfs) | 94.4 ms | 103 ms | 157 ms | ×1.73 |
| TinyBase (indexeddb) | 321 ms | 349 ms | 370 ms | ×5.87 |
| SQLite (opfs) | 755 ms | 819 ms | 1.24 s | ×13.80 |
| Dexie (indexeddb) | 2.19 s | 2.25 s | 2.4 s | ×40.10 |

### write-delta, 10,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| lokijs (indexeddb) | 28.9 ms | 36.5 ms | 60 ms | ×0.96 |
| LokiTS (indexeddb) | 30.2 ms | 36.5 ms | 45.5 ms | ×1.00 |
| Dexie (indexeddb) | 31.7 ms | 33.1 ms | 35 ms | ×1.05 |
| TinyBase (indexeddb) | 69.9 ms | 80.5 ms | 98.2 ms | ×2.31 |
| LokiTS (opfs) | 80.3 ms | 93.6 ms | 191 ms | ×2.66 |
| SQLite (opfs) | 543 ms | 553 ms | 560 ms | ×17.96 |

### cold-start, 10,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| Dexie (indexeddb) | 2.7 ms | 4.1 ms | 5.1 ms | ×0.09 |
| SQLite (opfs) | 14.8 ms | 15.4 ms | 24.5 ms | ×0.47 |
| LokiTS (opfs) | 30.5 ms | 37.1 ms | 43.2 ms | ×0.98 |
| LokiTS (indexeddb) | 31.2 ms | 38.8 ms | 64.8 ms | ×1.00 |
| lokijs (indexeddb) | 31.7 ms | 42.8 ms | 105 ms | ×1.02 |
| TinyBase (indexeddb) | 198 ms | 209 ms | 235 ms | ×6.34 |

### write-all, 100,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| LokiTS (indexeddb) | 825 ms | 844 ms | 985 ms | ×1.00 |
| lokijs (indexeddb) | 833 ms | 839 ms | 1.2 s | ×1.01 |
| LokiTS (opfs) | 1.27 s | 1.78 s | 2.25 s | ×1.53 |
| TinyBase (indexeddb) | 3.76 s | 3.85 s | 3.92 s | ×4.55 |
| SQLite (opfs) | 8.01 s | 8.03 s | 8.12 s | ×9.71 |
| Dexie (indexeddb) | 23.3 s | 23.3 s | 24 s | ×28.20 |

### write-delta, 100,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| Dexie (indexeddb) | 29.4 ms | 30.1 ms | 31.4 ms | ×0.20 |
| lokijs (indexeddb) | 134 ms | 156 ms | 167 ms | ×0.92 |
| LokiTS (indexeddb) | 146 ms | 190 ms | 202 ms | ×1.00 |
| LokiTS (opfs) | 789 ms | 902 ms | 1.03 s | ×5.42 |
| SQLite (opfs) | 835 ms | 843 ms | 901 ms | ×5.73 |
| TinyBase (indexeddb) | 840 ms | 881 ms | 972 ms | ×5.77 |

### cold-start, 100,000 documents, chromium

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| Dexie (indexeddb) | 2.2 ms | 2.4 ms | 2.4 ms | ×0.005 |
| SQLite (opfs) | 31.7 ms | 36 ms | 37.8 ms | ×0.08 |
| LokiTS (opfs) | 360 ms | 371 ms | 372 ms | ×0.85 |
| lokijs (indexeddb) | 384 ms | 453 ms | 527 ms | ×0.91 |
| LokiTS (indexeddb) | 422 ms | 426 ms | 519 ms | ×1.00 |
| TinyBase (indexeddb) | 2.34 s | 2.44 s | 2.49 s | ×5.54 |

### write-all, 10,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| lokijs (indexeddb) | 73 ms | 75 ms | 85 ms | ×0.61 |
| LokiTS (indexeddb) | 120 ms | 128 ms | 172 ms | ×1.00 |
| SQLite (opfs) | 470 ms | 569 ms | 854 ms | ×3.92 |
| LokiTS (opfs) | 541 ms | 549 ms | 629 ms | ×4.51 |
| TinyBase (indexeddb) | 770 ms | 864 ms | 957 ms | ×6.42 |
| Dexie (indexeddb) | 3.76 s | 3.95 s | 5.32 s | ×31.36 |

### write-delta, 10,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| lokijs (indexeddb) | 36 ms | 39 ms | 41 ms | ×0.71 |
| LokiTS (indexeddb) | 51 ms | 55 ms | 89 ms | ×1.00 |
| Dexie (indexeddb) | 94 ms | 99 ms | 119 ms | ×1.84 |
| TinyBase (indexeddb) | 199 ms | 296 ms | 1.12 s | ×3.90 |
| SQLite (opfs) | 205 ms | 211 ms | 663 ms | ×4.02 |
| LokiTS (opfs) | 503 ms | 580 ms | 781 ms | ×9.86 |

### cold-start, 10,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| SQLite (opfs) | 4 ms | 5 ms | 5 ms | ×0.05 |
| Dexie (indexeddb) | 6 ms | 7 ms | 8 ms | ×0.08 |
| lokijs (indexeddb) | 53 ms | 58 ms | 134 ms | ×0.70 |
| LokiTS (indexeddb) | 76 ms | 121 ms | 182 ms | ×1.00 |
| LokiTS (opfs) | 85 ms | 94 ms | 101 ms | ×1.12 |
| TinyBase (indexeddb) | 457 ms | 522 ms | 569 ms | ×6.01 |

### write-all, 100,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| lokijs (indexeddb) | 1.57 s | 2.72 s | 3.07 s | ×0.41 |
| LokiTS (indexeddb) | 3.86 s | 3.97 s | 5.36 s | ×1.00 |
| SQLite (opfs) | 4.18 s | 4.24 s | 4.38 s | ×1.08 |
| LokiTS (opfs) | 5.45 s | 5.58 s | 5.92 s | ×1.41 |
| TinyBase (indexeddb) | 7.83 s | 8.29 s | 8.37 s | ×2.03 |
| Dexie (indexeddb) | 43 s | 43.4 s | 47.4 s | ×11.12 |

### write-delta, 100,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| Dexie (indexeddb) | 95 ms | 97 ms | 100 ms | ×0.19 |
| lokijs (indexeddb) | 236 ms | 237 ms | 246 ms | ×0.47 |
| SQLite (opfs) | 324 ms | 346 ms | 645 ms | ×0.64 |
| LokiTS (indexeddb) | 504 ms | 592 ms | 722 ms | ×1.00 |
| TinyBase (indexeddb) | 1.5 s | 1.58 s | 1.59 s | ×2.97 |
| LokiTS (opfs) | 2.12 s | 2.15 s | 2.21 s | ×4.21 |

### cold-start, 100,000 documents, firefox

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| Dexie (indexeddb) | 6 ms | 7 ms | 10 ms | ×0.01 |
| SQLite (opfs) | 6 ms | 7 ms | 7 ms | ×0.01 |
| lokijs (indexeddb) | 374 ms | 387 ms | 497 ms | ×0.69 |
| LokiTS (indexeddb) | 542 ms | 561 ms | 583 ms | ×1.00 |
| LokiTS (opfs) | 726 ms | 734 ms | 829 ms | ×1.34 |
| TinyBase (indexeddb) | 3.67 s | 3.68 s | 3.74 s | ×6.77 |

### write-all, 10,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| LokiTS (opfs) | 77 ms | 87 ms | 105 ms | ×0.64 |
| lokijs (indexeddb) | 80 ms | 92 ms | 131 ms | ×0.67 |
| LokiTS (indexeddb) | 120 ms | 150 ms | 168 ms | ×1.00 |
| SQLite (opfs) | 296 ms | 434 ms | 548 ms | ×2.47 |
| TinyBase (indexeddb) | 519 ms | 552 ms | 670 ms | ×4.33 |
| Dexie (indexeddb) | 5.29 s | 6.28 s | 7.15 s | ×44.10 |

### write-delta, 10,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| lokijs (indexeddb) | 58 ms | 63 ms | 69 ms | ×0.44 |
| SQLite (opfs) | 61 ms | 72 ms | 78 ms | ×0.46 |
| LokiTS (opfs) | 71 ms | 98 ms | 108 ms | ×0.53 |
| LokiTS (indexeddb) | 133 ms | 168 ms | 320 ms | ×1.00 |
| TinyBase (indexeddb) | 150 ms | 804 ms | 1.27 s | ×1.13 |
| Dexie (indexeddb) | 177 ms | 224 ms | 1.63 s | ×1.33 |

### cold-start, 10,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| SQLite (opfs) | 2 ms | 2 ms | 4 ms | ×0.06 |
| Dexie (indexeddb) | 5 ms | 6 ms | 7 ms | ×0.15 |
| lokijs (indexeddb) | 31 ms | 36 ms | 60 ms | ×0.94 |
| LokiTS (indexeddb) | 33 ms | 37 ms | 74 ms | ×1.00 |
| LokiTS (opfs) | 33 ms | 38 ms | 58 ms | ×1.00 |
| TinyBase (indexeddb) | 220 ms | 232 ms | 234 ms | ×6.67 |

### write-all, 100,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| LokiTS (opfs) | 1.39 s | 1.41 s | 1.5 s | ×0.70 |
| LokiTS (indexeddb) | 2 s | 2 s | 2.14 s | ×1.00 |
| lokijs (indexeddb) | 2.42 s | 2.66 s | 2.8 s | ×1.22 |
| SQLite (opfs) | 2.79 s | 2.8 s | 2.8 s | ×1.40 |
| TinyBase (indexeddb) | 5.52 s | 5.68 s | 5.78 s | ×2.77 |
| Dexie (indexeddb) | 70 s | 75.5 s | 75.8 s | ×35.10 |

### write-delta, 100,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| SQLite (opfs) | 69 ms | 75 ms | 80 ms | ×0.26 |
| Dexie (indexeddb) | 119 ms | 122 ms | 142 ms | ×0.45 |
| lokijs (indexeddb) | 227 ms | 266 ms | 326 ms | ×0.85 |
| LokiTS (indexeddb) | 266 ms | 267 ms | 287 ms | ×1.00 |
| LokiTS (opfs) | 651 ms | 698 ms | 758 ms | ×2.45 |
| TinyBase (indexeddb) | 1.99 s | 2.03 s | 2.1 s | ×7.50 |

### cold-start, 100,000 documents, webkit

| Engine | Median | p75 | p99 | vs LokiTS (indexeddb) |
|---|---|---|---|---|
| SQLite (opfs) | 1 ms | 1 ms | 2 ms | ×0.003 |
| Dexie (indexeddb) | 7 ms | 7 ms | 18 ms | ×0.02 |
| LokiTS (indexeddb) | 308 ms | 339 ms | 360 ms | ×1.00 |
| lokijs (indexeddb) | 316 ms | 358 ms | 361 ms | ×1.03 |
| LokiTS (opfs) | 328 ms | 333 ms | 390 ms | ×1.06 |
| TinyBase (indexeddb) | 2.64 s | 2.68 s | 2.69 s | ×8.56 |

## Engines

- **LokiTS**: Default options (no cloning). Unique indexes on id and email (lookups with by()), binary index on age, DynamicView for the live query.
- **lokijs**: Same configuration as LokiTS: default options, unique indexes on id and email, binary index on age.
- **LokiDB**: Default options. Unique indexes on id and email (lookups with by()), ranged index on age, DynamicView for the live query. Unmaintained since 2022.
- **TinyBase**: Store with indexes on email and age (range = union of age slices). Ad hoc queries are defined, read and deleted per call so they are not maintained afterwards; top scores use getSortedRowIds. One transaction per bulk insert.
- **RxDB**: Memory storage, no dev-mode, no schema validator (the fastest setup). Indexes on email and age; string primary key (ids converted on insert). Live query through the query observable. Identical queries are answered from the RxDB query cache while the data does not change.
- **SQLite**: node:sqlite, in-memory database, cached prepared statements, SELECT * (full rows, tags kept as JSON text), one transaction per bulk insert. No live queries.
- **LokiTS (fs)**: Same collection setup as in memory; Loki.open, then saveDatabase() per write. Durability: atomic replace with fsync.
- **LokiTS (fs-structured)**: Same collection setup as in memory; Loki.open, then saveDatabase() per write. Durability: one file per collection, atomic generations with fsync.
- **lokijs (fs)**: Default LokiFsAdapter, same collection setup as LokiTS. Durability: file overwritten in place, no fsync.
- **LokiDB (fs)**: @lokidb/fs-storage, unique indexes on id and email. No age index: LokiDB 2.1.0 loses the comparator of a ranged index on reload (restore() reads a function from JSON), so it does less index work on writes than the others. Durability: temporary file then rename, no fsync.
- **TinyBase (file)**: File persister, explicit save() per write; email index rebuilt on open. Durability: temporary file then rename, no fsync.
- **SQLite (file)**: node:sqlite, one transaction per write (committed = persisted, persist() is a no-op). Durability: WAL, synchronous=FULL (fsync on commit).
- **Dexie (indexeddb)**: Primary key id, unique index on email, index on age; bulkAdd and bulkUpdate (one transaction each). Writes are persisted when they resolve. Durability: IndexedDB with the browser default durability.
- **lokijs (indexeddb)**: IncrementalIndexedDBAdapter, same collection setup as LokiTS. Durability: incremental IndexedDB adapter.
- **LokiTS (indexeddb)**: Same collection setup as in memory; Loki.open, then saveDatabase() per write. LokiIndexedDBAdapter. Durability: one IndexedDB transaction per save, changed chunks only.
- **LokiTS (opfs)**: Same collection setup as in memory; Loki.open, then saveDatabase() per write. LokiPartitioningAdapter over LokiOpfsAdapter, as the README recommends. Durability: one file per collection, atomically replaced files.
- **SQLite (opfs)**: Official WASM build in a dedicated Worker (OPFS needs one); every call crosses postMessage, as it would in an app. Durability: OPFS SAH pool VFS in a Worker, synchronous=FULL.
- **TinyBase (indexeddb)**: IndexedDB persister, explicit save() per write; email index rebuilt on open. Durability: IndexedDB persister.

## Versions

- node:sqlite (SQLite) 3.51.3
- @lokits/core 0.1.0-dev
- lokijs 1.5.12
- @lokidb/loki 2.1.0
- @lokidb/fs-storage 2.1.0
- @lokidb/indexed-storage 2.1.0
- tinybase 10.0.1
- rxdb 17.6.0
- dexie 4.4.6
- @sqlite.org/sqlite-wasm 3.53.4-build2
- mitata 1.0.34
