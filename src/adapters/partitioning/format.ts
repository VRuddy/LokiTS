import type { Loki } from '../../core/Loki';
import type { LokiKeyListingAdapter, LokiLineStreamAdapter } from '../../types/adapter';

export const MANIFEST_KEY = 'lokiPartitions';

export interface PartitionEntry {
  name: string;
  /** Names relative to the database (`<i>.g<n>-<suffix>[.<page>]`), stored under `<db>.<file>`. */
  files: string[];
}

export interface PartitionManifest {
  version: 1;
  generation: number;
  collections: PartitionEntry[];
}

/** The database without its documents, serialized like the historical container, plus the manifest. */
export function buildContainer(db: Loki, manifest?: PartitionManifest): string {
  const text = db.serializeDestructured({ partitioned: true, partition: -1 }) as string;
  if (!manifest) {
    return text;
  }
  const container = JSON.parse(text);
  container[MANIFEST_KEY] = manifest;
  return JSON.stringify(container);
}

/** Storage key of a file listed in the manifest: names are relative, so a copied or moved database reads its own files. */
export const fileKey = (dbname: string, file: string) => `${dbname}.${file}`;

const isEntry = (entry: unknown): entry is PartitionEntry =>
  typeof (entry as PartitionEntry)?.name === 'string' &&
  Array.isArray((entry as PartitionEntry).files) &&
  (entry as PartitionEntry).files.every((file) => typeof file === 'string');

/**
 * The manifest of a container, checked before anything is read or deleted through it: one entry per
 * collection of the container, in order, listing only generation files of `dbname`.
 */
export function readManifest(
  container: Record<string, unknown>,
  dbname: string,
): PartitionManifest | undefined {
  const manifest = container[MANIFEST_KEY] as PartitionManifest | undefined;
  if (manifest === undefined) {
    return undefined;
  }
  if (manifest?.version !== 1) {
    throw new Error('LokiPartitioningAdapter: unsupported partition manifest');
  }
  const collections = Array.isArray(container.collections) ? container.collections : [];
  if (
    !Number.isInteger(manifest.generation) ||
    manifest.generation < 0 ||
    !Array.isArray(manifest.collections) ||
    !manifest.collections.every(isEntry)
  ) {
    throw new Error('LokiPartitioningAdapter: malformed partition manifest');
  }
  if (
    manifest.collections.length !== collections.length ||
    !manifest.collections.every((entry, index) => entry.name === collections[index]?.name)
  ) {
    throw new Error('LokiPartitioningAdapter: the partition manifest does not match the container');
  }
  for (const entry of manifest.collections) {
    for (const file of entry.files) {
      if (!isGenerationKey(dbname, fileKey(dbname, file))) {
        throw new Error(
          `LokiPartitioningAdapter: the partition manifest lists an invalid file ${file}`,
        );
      }
    }
  }
  return manifest;
}

/** Storage keys of the files of manifest entries; anything but a generation file is left out, so it is never deleted. */
export const manifestKeys = (dbname: string, entries: PartitionEntry[]): string[] =>
  entries
    .flatMap((entry) => entry.files.map((file) => fileKey(dbname, file)))
    .filter((key) => isGenerationKey(dbname, key));

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Generation files (`<db>.<n>.g<generation>-<suffix>`, optionally paged): the only names found by listing that are safe to delete. */
export function isGenerationKey(dbname: string, key: string): boolean {
  return new RegExp(`^${escapeRegExp(dbname)}\\.\\d+\\.g\\d+-[a-z0-9]+(?:\\.\\d+)?$`).test(key);
}

export const isLineStream = (adapter: unknown): adapter is LokiLineStreamAdapter =>
  typeof (adapter as LokiLineStreamAdapter)?.readLines === 'function' &&
  typeof (adapter as LokiLineStreamAdapter)?.writeLines === 'function';

export const canListKeys = (adapter: unknown): adapter is LokiKeyListingAdapter =>
  typeof (adapter as LokiKeyListingAdapter)?.listKeys === 'function';

export const missingFile = (name: string) =>
  new Error(`LokiPartitioningAdapter: partition ${name} is missing`);
