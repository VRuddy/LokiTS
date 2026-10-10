# LokiTS

Modernisation TypeScript de [LokiJS](https://github.com/techfort/LokiJS), une
base de données NoSQL orientée document, fonctionnant en mémoire.

> **Projet en cours de reprise.** LokiTS est un fork communautaire indépendant,
> pas un projet officiel de l’auteur original. L’API et le nom du package
> peuvent encore évoluer avant une première version stable.

L’objectif est de conserver les performances et les concepts utiles de LokiJS
(collections, index binaires, DynamicViews et requêtes inspirées de MongoDB)
tout en modernisant progressivement le code, le typage et l’outillage.

## Fonctionnalités héritées

- Base de données NoSQL en mémoire orientée document
- Collections avec index uniques et index binaires
- Dynamic Views pour les sous-ensembles de données
- Requêtes et transformations inspirées de MongoDB
- Adaptateurs de persistance extensibles
- Compatibilité historique navigateur et Node.js

## État actuel

La migration TypeScript n’est pas encore publiée comme package stable. Pour le
moment, l’implémentation JavaScript héritée reste dans `src/`.

```bash
pnpm install   # Node >= 22.12 pour le développement
pnpm test       # Vitest
pnpm check      # Biome (lint + format)
pnpm typecheck  # tsc --noEmit
pnpm build      # tsup -> dist/ (ESM + CJS + .d.ts)
```

### Persistance

```ts
import { Loki, LokiFsAdapter } from 'loki-ts';

const db = await Loki.open('app.db', { adapter: new LokiFsAdapter() });
const users = db.getCollection('users') ?? db.addCollection('users');
users.insert({ name: 'odin' });
await db.saveDatabase();
```

Les méthodes de persistance renvoient des Promises et acceptent toujours leur callback d’origine.

## Modernisation prévue

- Outillage moderne avec pnpm, Biome, Vitest et tsup
- Migration progressive vers TypeScript strict et découpage en modules
- API typée pour le cœur, les requêtes, les index et les événements
- Adaptateurs modernes pour FS, IndexedDB, OPFS et mémoire
- Persistance basée sur `Promise`/`async` et évaluation du support Web Worker
- Benchmarks reproductibles et CI multi-version/multi-plateforme
- Documentation moderne avec VitePress ou Starlight et TypeDoc
- Publication ESM/CommonJS après validation de la compatibilité

Les changements de comportement ou de compatibilité seront documentés dans le
changelog et accompagnés de tests.

## Upstream et attribution

Ce dépôt conserve l’historique et le code de LokiJS. Le projet original est
développé par TechFort/Joe Minichino, avec les contributions de ses
contributeurs. Voir [LICENSE.txt](LICENSE.txt) pour les conditions de licence et
[CHANGELOG.md](CHANGELOG.md) pour l’historique hérité.

LokiJS et les marques associées restent l’héritage du projet original. LokiTS
est un nom de projet distinct et ne doit pas être présenté comme une version
officielle ou soutenue par TechFort.

## Licence

LokiTS est distribué sous licence MIT. Le texte complet et l’attribution
originale sont conservés dans [LICENSE.txt](LICENSE.txt).
