import Loki from '../../src/index';

// Les specs historiques utilisent `loki` comme un objet dynamique (statiques, `new loki(...)`).
// biome-ignore lint/suspicious/noExplicitAny: typage permissif tant que les specs ne sont pas resserrées
export const loki: any = Loki;
