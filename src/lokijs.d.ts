// Shim temporaire : le moteur historique est encore du JavaScript (UMD).
// À supprimer quand src/lokijs.js aura été porté en modules TypeScript (phase 2).
// biome-ignore lint/suspicious/noExplicitAny: typage du code hérité non encore porté
declare const loki: any;
export = loki;
