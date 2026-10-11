import { LokiFsAdapter } from './FsAdapter';
import { LokiPartitioningAdapter } from './PartitioningAdapter';

export interface LokiFsStructuredAdapterOptions {
  /** Commit through a manifest (default: true); false keeps the original layout, readable by LokiJS. */
  generations?: boolean;
}

/**
 * Node adapter for large databases: one file per collection, one document per line, streamed, and only
 * modified collections rewritten. Reads the files of the original LokiFsStructuredAdapter.
 */
export class LokiFsStructuredAdapter extends LokiPartitioningAdapter {
  constructor(options: LokiFsStructuredAdapterOptions = {}) {
    // the layout is fixed: no other option (paging, legacyFormat...) may change it
    super(new LokiFsAdapter(), { legacyFormat: 'lines', generations: options.generations ?? true });
  }
}
