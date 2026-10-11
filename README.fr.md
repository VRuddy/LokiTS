# LokiTS

[English](README.md) | **Français**

Une base de documents en mémoire écrite en TypeScript strict. Les requêtes sont synchrones et s'exécutent en
mémoire ; la persistance est asynchrone et passe par OPFS, IndexedDB, localStorage ou le système de fichiers.
LokiTS est le successeur maintenu de [LokiJS](https://github.com/techfort/LokiJS) et de sa réécriture TypeScript
LokiDB, qui ne sont plus développés.

```ts
import { Loki } from '@lokits/core';

const db = await Loki.open('app.db', { autosave: true });
const users = db.getCollection<{ name: string; age: number }>('users') ?? db.addCollection('users');

users.insert({ name: 'odin', age: 50 });
users.find({ age: { $gte: 40 } }); // [{ name: 'odin', age: 50, $loki: 1, meta: { ... } }]
```

## Pourquoi LokiTS

- **Typé de bout en bout** : collections, requêtes, événements et options sont typés ; le code est en
  TypeScript strict.
- **API Promise** : `Loki.open`, `await db.saveDatabase()` ; les callbacks continuent de fonctionner pour le code
  existant.
- **Stockage moderne** : OPFS avec écritures atomiques, IndexedDB natif qui ne réécrit que ce qui a changé,
  écritures de fichiers résistantes aux plantages sous Node.js, chiffrement AES-GCM.
- **Compatible avec LokiJS** : mêmes requêtes, index et Dynamic Views ; les bases enregistrées par LokiJS s'ouvrent
  telles quelles (un ancien adaptateur IndexedDB demande une courte migration).
- **Aucune dépendance à l'exécution**, builds ESM et CommonJS, testé sous Node.js, Chromium, Firefox et WebKit.

## Installation

```sh
pnpm add @lokits/core   # ou npm install @lokits/core
```

## Persistance

Choisissez un adaptateur selon votre environnement, ou aucun pour garder la base en mémoire. Sans adaptateur,
LokiTS utilise le système de fichiers sous Node.js et localStorage dans le navigateur.

| Adaptateur | Environnement | Usage |
|---|---|---|
| `LokiFsAdapter` (par défaut sous Node.js) | Node.js | Un fichier par base, écrit de façon atomique |
| `LokiFsStructuredAdapter` | Node.js | Grosses bases : un fichier par collection, en flux, seules les collections modifiées sont réécrites |
| `LokiOpfsAdapter` | Navigateur, Worker | Origin private file system, fichiers remplacés de façon atomique |
| `LokiIndexedDBAdapter` | Navigateur | IndexedDB, seuls les paquets modifiés sont réécrits |
| `LokiLocalStorageAdapter` (par défaut dans le navigateur) | Navigateur | Petites bases (environ 5 Mo) |
| `LokiPartitioningAdapter` | Partout | Une clé par collection au-dessus d'un autre adaptateur |
| `LokiEncryptedAdapter` | Partout | Chiffrement AES-256-GCM au-dessus d'un autre adaptateur |
| `LokiMemoryAdapter` | Partout | Tests |

```ts
import { Loki, LokiIndexedDBAdapter, LokiOpfsAdapter, LokiPartitioningAdapter } from '@lokits/core';

const adapter = (await LokiOpfsAdapter.isSupported())
  ? new LokiPartitioningAdapter(new LokiOpfsAdapter({ directory: 'my-app' }))
  : new LokiIndexedDBAdapter();
const db = await Loki.open('app.db', { adapter });
```

```ts
import { Loki, LokiEncryptedAdapter, LokiFsAdapter } from '@lokits/core';

const adapter = new LokiEncryptedAdapter(new LokiFsAdapter(), { secret: process.env.DB_SECRET! });
const db = await Loki.open('app.db', { adapter });
```

Les navigateurs peuvent effacer ce stockage quand l'espace manque : appelez `navigator.storage.persist()` pour
demander un stockage persistant. Écrire son propre adaptateur tient en quelques lignes ; voir le tutoriel
[Persistence Adapters](tutorials/Persistence%20Adapters.md) (en anglais), qui contient des recettes pour un
serveur HTTP, AWS S3 et NativeScript.

## Fonctionnalités

- Requêtes à la MongoDB (`$eq`, `$gt`, `$in`, `$regex`, `$and`, `$or`…) et résultats chaînables avec tri,
  jointures, map et reduce ([Query Examples](tutorials/Query%20Examples.md))
- Index uniques, exacts et binaires adaptatifs ([Indexing and Query performance](tutorials/Indexing%20and%20Query%20performance.md))
- Dynamic Views : sous-ensembles vivants d'une collection, mis à jour de façon incrémentale
- Transforms nommées et paramétrables ([Collection Transforms](tutorials/Collection%20Transforms.md))
- Changes API pour suivre les insertions, mises à jour et suppressions ([Changes API](tutorials/Changes%20API.md))
- TTL des documents, autosave, autoload et sauvegardes groupées

## Venir de LokiJS

Remplacez `lokijs` par `@lokits/core` et mettez à jour vos imports ; l'API est la même et les callbacks
fonctionnent toujours. Le [changelog](CHANGELOG.md) (en anglais) liste les changements cassants et les étapes de
migration. Sauvegardez les bases partitionnées, fs-structured et chiffrées avant leur première sauvegarde avec
LokiTS : elles passent à un format résistant aux plantages que LokiJS ne sait pas lire.

## Compatibilité

- Node.js 20.16 ou plus récent
- Navigateurs avec le support d'ES2022 ; testé dans Chromium, Firefox et WebKit

## Statut

LokiTS approche de la 1.0. À venir : des benchmarks publiés face à LokiJS et à d'autres bases pour navigateur, et
un site de documentation.

## Développement

```sh
pnpm install         # Node.js 22.12 ou plus récent
pnpm test            # tests unitaires (Vitest)
pnpm test:browser    # tests dans Chromium, Firefox et WebKit (Playwright)
pnpm check           # lint et format (Biome)
pnpm typecheck
pnpm build           # dist/ : ESM, CommonJS, déclarations de types
```

## Crédits

LokiTS repose sur LokiJS, créé par Joe Minichino ([TechFort](https://github.com/techfort/LokiJS)), avec des
contributions majeures de Dave ([obeliskos](https://github.com/obeliskos)), Radek Pietruszewski
([radex](https://github.com/radex)) et des contributeurs de LokiJS, dont Hans Klunder, Simon Hutchison et Stefano
Falda. LokiTS est un projet indépendant, pas une version officielle de LokiJS ni de TechFort.

## Licence

[MIT](LICENSE.txt). Copyright (c) 2026 VRuddy ; LokiJS copyright (c) 2015 TechFort.
