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

Sous Node, `LokiFsAdapter` écrit chaque sauvegarde de façon atomique (fichier temporaire, fsync,
renommage). Pour les grosses bases, `LokiFsStructuredAdapter` écrit une collection par fichier, en
flux, et ne réécrit que les collections modifiées ; un arrêt pendant une sauvegarde laisse l’état
précédent lisible. Il n’y a pas de verrou : deux process qui sauvegardent la même base à tour de rôle
la laissent lisible (la dernière sauvegarde l’emporte entièrement), et une sauvegarde pendant
laquelle un autre écrivain valide la sienne échoue. Un
arrêt brutal pendant une écriture peut laisser un fichier temporaire caché (`.<nom>.<pid>.<aléa>.tmp`),
qui n’est pas supprimé automatiquement. `LokiEncryptedAdapter` chiffre (AES-256-GCM) ce que stocke
un autre adaptateur (`LokiFsAdapter`, `LokiMemoryAdapter`…) ; il peut être placé sous un adaptateur
partitionné, pas autour :

```ts
import { Loki, LokiEncryptedAdapter, LokiFsAdapter } from 'loki-ts';

const adapter = new LokiEncryptedAdapter(new LokiFsAdapter(), { secret: process.env.DB_SECRET! });
const db = await Loki.open('app.db', { adapter });
```

Le chiffrement authentifie chaque fichier, pas la base dans son ensemble : quelqu’un qui peut écrire
sur le disque peut remettre une ancienne copie d’un fichier ou échanger deux partitions sans que le
déchiffrement échoue.

Les bases partitionnées et `fs-structured` sont converties au format à générations, et les bases
chiffrées en AES-GCM, à leur première sauvegarde : LokiJS ne peut plus les lire ensuite. Faites une
copie avant d’ouvrir une base existante, ou passez `generations: false` pour garder le format
partitionné d’origine, avec sa fragilité : un arrêt pendant une sauvegarde peut alors désynchroniser
la base.

Dans le navigateur, localStorage reste le défaut (environ 5 Mo). Pour une vraie base, choisir
`LokiIndexedDBAdapter` (ne réécrit que les paquets de documents modifiés, relit les bases de
l’adaptateur incrémental de lokijs) ou `LokiOpfsAdapter` (Origin Private File System, un fichier
par base ; sous `LokiPartitioningAdapter`, un fichier par collection) :

```ts
import { Loki, LokiIndexedDBAdapter, LokiOpfsAdapter, LokiPartitioningAdapter } from 'loki-ts';

const adapter = (await LokiOpfsAdapter.isSupported())
  ? new LokiPartitioningAdapter(new LokiOpfsAdapter({ directory: 'my-app' }))
  : new LokiIndexedDBAdapter();
const db = await Loki.open('app.db', { adapter });
```

Le navigateur peut effacer ce stockage quand l’espace manque : `navigator.storage.persist()` le
demande persistant. Les bases de l’ancien `LokiIndexedAdapter` de lokijs se migrent avec la recette
du [tutoriel](tutorials/Persistence%20Adapters.md).

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
