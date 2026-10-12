# LokiTS benchmarks

Reproducible comparison of LokiTS with lokijs 1.5.12, LokiDB, TinyBase, RxDB (memory storage), Dexie and SQLite,
on Node.js and in Chromium, Firefox and WebKit. Results and the generated report live in `results/`.

```sh
pnpm install && pnpm build
pnpm bench            # Node.js, child processes per engine (--engines, --family, --sizes, --scenarios, --rounds, --quick)
pnpm bench:browser    # the same scenarios in three browsers (Playwright; --sizes, --family, --quick)
pnpm bench:report     # results/REPORT.md from the latest runs
pnpm bench:quick      # LokiTS vs lokijs regression guard (--update-baseline to reset the baseline)
```

Node.js 22.18 or later runs the TypeScript sources directly. The method, fairness rules and known limits are
written at the top of `results/REPORT.md`. Each engine's configuration is in `src/engines/`; corrections are
welcome.
