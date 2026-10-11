// Replaces loki-fs-structured-adapter.js from LokiJS, MIT. Main author: obeliskos (Dave), with LokiJS contributors.
import { LokiFsAdapter } from './FsAdapter';
import { LokiPartitioningAdapter } from './PartitioningAdapter';

/**
 * Node adapter for large databases: one file per collection, one document per line, streamed, and only
 * modified collections rewritten. Reads the files of the original LokiFsStructuredAdapter.
 */
export class LokiFsStructuredAdapter extends LokiPartitioningAdapter {
  constructor(options: { generations?: boolean } = {}) {
    // the layout is fixed: no other option (paging, legacyFormat...) may change it
    super(new LokiFsAdapter(), { legacyFormat: 'lines', generations: options.generations ?? true });
  }
}
