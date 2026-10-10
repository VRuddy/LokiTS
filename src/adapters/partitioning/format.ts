import type { Loki } from '../../core/Loki';
import type { LokiKeyListingAdapter, LokiLineStreamAdapter } from '../../types/adapter';

export const MANIFEST_KEY = 'lokiPartitions';

export interface PartitionEntry {
  name: string;
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

export function readManifest(container: Record<string, unknown>): PartitionManifest | undefined {
  const manifest = container[MANIFEST_KEY] as PartitionManifest | undefined;
  if (manifest === undefined) {
    return undefined;
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.collections)) {
    throw new Error('LokiPartitioningAdapter: unsupported partition manifest');
  }
  return manifest;
}

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
