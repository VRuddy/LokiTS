// lokijs ships no types; the bench only calls the API that LokiTS shares with it
declare module 'lokijs' {
  // biome-ignore lint/suspicious/noExplicitAny: untyped package
  const Loki: any;
  export default Loki;
}
declare module 'lokijs/src/incremental-indexeddb-adapter.js' {
  // biome-ignore lint/suspicious/noExplicitAny: untyped package
  const IncrementalIndexedDBAdapter: any;
  export default IncrementalIndexedDBAdapter;
}
