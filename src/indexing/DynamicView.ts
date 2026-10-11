import type { Collection } from '../core/Collection';
import { LokiEventEmitter } from '../events/EventEmitter';
import { Resultset, type ResultsetDataOptions, type SimpleSortOptions } from '../query/Resultset';
import type { LokiDocument } from '../types/document';
import type { LokiQuery } from '../types/query';
import { deepFreeze, freeze } from '../utils/freeze';

/** Options of a DynamicView. */
export interface DynamicViewOptions {
  persistent?: boolean;
  sortPriority?: 'passive' | 'active';
  minRebuildInterval?: number;
}

/** A filter of the DynamicView filter pipeline. */
export interface DynamicViewFilter {
  type: 'find' | 'where' | string;
  val: any;
  uid?: string | number;
}

/** Simple sort criteria of a DynamicView. */
export interface DynamicViewSortCriteriaSimple {
  propname: string;
  options: boolean | SimpleSortOptions;
}

/** Compound sort criteria: property names or [propertyname, isdesc] pairs. */
export type DynamicViewSortCriteria = (string | [string, boolean | SimpleSortOptions])[];

/**
 * DynamicView class is a versatile 'live' view class which can have filters and sorts applied.
 *    Collection.addDynamicView(name) instantiates this DynamicView object and notifies it
 *    whenever documents are add/updated/removed so it can remain up-to-date. (chainable)
 *
 * @example
 * var mydv = mycollection.addDynamicView('test');  // default is non-persistent
 * mydv.applyFind({ 'doors' : 4 });
 * mydv.applyWhere(function(obj) { return obj.name === 'Toyota'; });
 * var results = mydv.data();
 *
 * @param collection - A reference to the collection to work against
 * @param name - The name of this dynamic view
 * @param options - (Optional) Pass in object with 'persistent' and/or 'sortPriority' options.
 * @param options.persistent - (default false) indicates if view is to main internal results array in 'resultdata'
 * @param options.sortPriority - (default 'passive') 'passive' (sorts performed on call to data) or 'active' (after updates)
 * @param options.minRebuildInterval - minimum rebuild interval (need clarification to docs here)
 * @see {@link Collection#addDynamicView} to construct instances of DynamicView
 */
export interface DynamicViewEvents<T extends object = any> {
  rebuild: [view: DynamicView<T>];
  filter: [];
  sort: [];
  [event: string]: unknown[];
}

export class DynamicView<T extends object = any> extends LokiEventEmitter<DynamicViewEvents<T>> {
  collection!: Collection<T>;
  name!: string;
  rebuildPending!: boolean;
  options!: DynamicViewOptions;
  resultset!: Resultset<T>;
  resultdata!: LokiDocument<T>[];
  resultsdirty!: boolean;
  cachedresultset!: Resultset<T> | null;
  filterPipeline!: DynamicViewFilter[];
  sortFunction!: ((a: LokiDocument<T>, b: LokiDocument<T>) => number | undefined) | null;
  sortCriteria!: DynamicViewSortCriteria | null;
  sortCriteriaSimple!: DynamicViewSortCriteriaSimple | null;
  sortDirty!: boolean;

  constructor(collection: Collection<T>, name: string, options?: DynamicViewOptions) {
    super();
    this.collection = collection;
    this.name = name;
    this.rebuildPending = false;
    this.options = options || {};

    if (!Object.hasOwn(this.options, 'persistent')) {
      this.options.persistent = false;
    }

    // 'persistentSortPriority':
    // 'passive' will defer the sort phase until they call data(). (most efficient overall)
    // 'active' will sort async whenever next idle. (prioritizes read speeds)
    if (!Object.hasOwn(this.options, 'sortPriority')) {
      this.options.sortPriority = 'passive';
    }

    if (!Object.hasOwn(this.options, 'minRebuildInterval')) {
      this.options.minRebuildInterval = 1;
    }

    this.resultset = new Resultset<T>(collection);
    this.resultdata = [];
    this.resultsdirty = false;

    this.cachedresultset = null;

    // keep ordered filter pipeline
    this.filterPipeline = [];
    if (!this.collection.disableFreeze) {
      Object.freeze(this.filterPipeline);
    }

    // sorting member variables
    // we only support one active search, applied using applySort() or applySimpleSort()
    this.sortFunction = null;
    this.sortCriteria = null;
    this.sortCriteriaSimple = null;
    this.sortDirty = false;

    // for now just have 1 event for when we finally rebuilt lazy view
    // once we refactor transactions, i will tie in certain transactional events

    this.events = {
      rebuild: [],
      filter: [],
      sort: [],
    };
  }

  /**
   * getSort() - used to get the current sort
   *
   * @returns function (sortFunction) or array (sortCriteria) or object (sortCriteriaSimple)
   */
  getSort():
    | DynamicView<T>['sortFunction']
    | DynamicView<T>['sortCriteria']
    | DynamicView<T>['sortCriteriaSimple'] {
    return this.sortFunction || this.sortCriteria || this.sortCriteriaSimple;
  }

  /**
   * rematerialize() - internally used immediately after deserialization (loading)
   *    This will clear out and reapply filterPipeline ops, recreating the view.
   *    Since where filters do not persist correctly, this method allows
   *    restoring the view to state where user can re-apply those where filters.
   *
   * @param options - (Optional) allows specification of 'removeWhereFilters' option
   * @returns This dynamic view for further chained ops.
   * @fires DynamicView.rebuild
   */
  rematerialize(options?: { removeWhereFilters?: boolean }): this {
    let fpl: number;
    let fpi: number;
    let idx: number;

    options = options || {};

    this.resultdata = [];
    this.resultsdirty = true;
    this.resultset = new Resultset<T>(this.collection);

    if (this.sortFunction || this.sortCriteria || this.sortCriteriaSimple) {
      this.sortDirty = true;
    }

    const wasFrozen = Object.isFrozen(this.filterPipeline);
    if (Object.hasOwn(options, 'removeWhereFilters')) {
      // for each view see if it had any where filters applied... since they don't
      // serialize those functions lets remove those invalid filters
      if (wasFrozen) {
        this.filterPipeline = this.filterPipeline.slice();
      }
      fpl = this.filterPipeline.length;
      fpi = fpl;
      while (fpi--) {
        if (this.filterPipeline[fpi].type === 'where') {
          if (fpi !== this.filterPipeline.length - 1) {
            this.filterPipeline[fpi] = this.filterPipeline[this.filterPipeline.length - 1];
          }
          this.filterPipeline.length--;
        }
      }
    }

    // back up old filter pipeline, clear filter pipeline, and reapply pipeline ops
    const ofp = this.filterPipeline;
    this.filterPipeline = [];

    // now re-apply 'find' filterPipeline ops
    fpl = ofp.length;
    for (idx = 0; idx < fpl; idx++) {
      this.applyFind(ofp[idx].val, ofp[idx].uid);
    }
    if (wasFrozen) {
      Object.freeze(this.filterPipeline);
    }

    // during creation of unit tests, i will remove this forced refresh and leave lazy
    this.data();

    // emit rebuild event in case user wants to be notified
    this.emit('rebuild', this);

    return this;
  }

  /**
   * branchResultset() - Makes a copy of the internal resultset for branched queries.
   *    Unlike this dynamic view, the branched resultset will not be 'live' updated,
   *    so your branched query should be immediately resolved and not held for future evaluation.
   *
   * @param transform - Optional name of collection transform, or an array of transform steps
   * @param parameters - optional parameters (if optional transform requires them)
   * @returns A copy of the internal resultset for branched queries.
   * @example
   * var db = new loki('test');
   * var coll = db.addCollection('mydocs');
   * var dv = coll.addDynamicView('myview');
   * var tx = [
   *   {
   *     type: 'offset',
   *     value: '[%lktxp]pageStart'
   *   },
   *   {
   *     type: 'limit',
   *     value: '[%lktxp]pageSize'
   *   }
   * ];
   * coll.addTransform('viewPaging', tx);
   *
   * // add some records
   *
   * var results = dv.branchResultset('viewPaging', { pageStart: 10, pageSize: 10 }).data();
   */
  branchResultset(transform?: string | any[], parameters?: object): Resultset<T> {
    const rs = this.resultset.branch();

    if (typeof transform === 'undefined') {
      return rs;
    }

    return rs.transform(transform, parameters);
  }

  /**
   * toJSON() - Override of toJSON to avoid circular references
   */
  toJSON(): DynamicView<T> {
    const copy = new DynamicView<T>(this.collection, this.name, this.options);
    copy.resultset = this.resultset;
    copy.resultdata = []; // let's not save data (copy) to minimize size
    copy.resultsdirty = true;
    copy.filterPipeline = this.filterPipeline;
    copy.sortFunction = this.sortFunction;
    copy.sortCriteria = this.sortCriteria;
    copy.sortCriteriaSimple = this.sortCriteriaSimple || null;
    copy.sortDirty = this.sortDirty;

    // avoid circular reference, reapply in db.loadJSON()
    copy.collection = null as any;

    return copy;
  }

  /**
   * removeFilters() - Used to clear pipeline and reset dynamic view to initial state.
   *     Existing options should be retained.
   * @param options - configure removeFilter behavior
   * @param options.queueSortPhase - (default: false) if true we will async rebuild view (maybe set default to true in future?)
   */
  removeFilters(options?: { queueSortPhase?: boolean }): void {
    options = options || {};

    this.rebuildPending = false;
    this.resultset.reset();
    this.resultdata = [];
    this.resultsdirty = true;

    this.cachedresultset = null;

    const wasFrozen = Object.isFrozen(this.filterPipeline);
    const filterChanged = this.filterPipeline.length > 0;
    // keep ordered filter pipeline
    this.filterPipeline = [];
    if (wasFrozen) {
      Object.freeze(this.filterPipeline);
    }

    // sorting member variables
    // we only support one active search, applied using applySort() or applySimpleSort()
    this.sortFunction = null;
    this.sortCriteria = null;
    this.sortCriteriaSimple = null;
    this.sortDirty = false;

    if (options.queueSortPhase === true) {
      this.queueSortPhase();
    }

    if (filterChanged) {
      this.emit('filter');
    }
  }

  /**
   * applySort() - Used to apply a sort to the dynamic view
   * @example
   * dv.applySort(function(obj1, obj2) {
   *   if (obj1.name === obj2.name) return 0;
   *   if (obj1.name > obj2.name) return 1;
   *   if (obj1.name < obj2.name) return -1;
   * });
   *
   * @param comparefun - a javascript compare function used for sorting
   * @returns this DynamicView object, for further chain ops.
   */
  applySort(comparefun: (a: LokiDocument<T>, b: LokiDocument<T>) => number | undefined): this {
    this.sortFunction = comparefun;
    this.sortCriteria = null;
    this.sortCriteriaSimple = null;

    this.queueSortPhase();
    this.emit('sort');

    return this;
  }

  /**
   * applySimpleSort() - Used to specify a property used for view translation.
   * @example
   * dv.applySimpleSort("name");
   *
   * @param propname - Name of property by which to sort.
   * @param options - boolean for sort descending or options object
   * @param options.desc - (default false) whether we should sort descending.
   * @param options.disableIndexIntersect - (default false) whether we should explicity not use array intersection.
   * @param options.forceIndexIntersect - (default false) force array intersection (if binary index exists).
   * @param options.useJavascriptSorting - (default false) whether results are sorted via basic javascript sort.
   * @returns this DynamicView object, for further chain ops.
   */
  applySimpleSort(propname: string, options?: boolean | SimpleSortOptions): this {
    this.sortCriteriaSimple = { propname: propname, options: options || false };
    if (!this.collection.disableFreeze) {
      deepFreeze(this.sortCriteriaSimple);
    }
    this.sortCriteria = null;
    this.sortFunction = null;

    this.queueSortPhase();
    this.emit('sort');

    return this;
  }

  /**
   * applySortCriteria() - Allows sorting a resultset based on multiple columns.
   * @example
   * // to sort by age and then name (both ascending)
   * dv.applySortCriteria(['age', 'name']);
   * // to sort by age (ascending) and then by name (descending)
   * dv.applySortCriteria(['age', ['name', true]);
   * // to sort by age (descending) and then by name (descending)
   * dv.applySortCriteria(['age', true], ['name', true]);
   *
   * @param criteria - array of property names or subarray of [propertyname, isdesc] used evaluate sort order
   * @returns Reference to this DynamicView, sorted, for future chain operations.
   */
  applySortCriteria(criteria: DynamicViewSortCriteria): this {
    this.sortCriteria = criteria;
    if (!this.collection.disableFreeze) {
      deepFreeze(this.sortCriteria);
    }
    this.sortCriteriaSimple = null;
    this.sortFunction = null;

    this.queueSortPhase();
    this.emit('sort');
    return this;
  }

  /**
   * startTransaction() - marks the beginning of a transaction.
   *
   * @returns this DynamicView object, for further chain ops.
   */
  startTransaction(): this {
    this.cachedresultset = this.resultset.copy();

    return this;
  }

  /**
   * commit() - commits a transaction.
   *
   * @returns this DynamicView object, for further chain ops.
   */
  commit(): this {
    this.cachedresultset = null;

    return this;
  }

  /**
   * rollback() - rolls back a transaction.
   *
   * @returns this DynamicView object, for further chain ops.
   */
  rollback(): this {
    this.resultset = this.cachedresultset as Resultset<T>;

    if (this.options.persistent) {
      // for now just rebuild the persistent dynamic view data in this worst case scenario
      // (a persistent view utilizing transactions which get rolled back), we already know the filter so not too bad.
      this.resultdata = this.resultset.data();

      this.emit('rebuild', this);
    }

    return this;
  }

  /**
   * Implementation detail.
   * _indexOfFilterWithId() - Find the index of a filter in the pipeline, by that filter's ID.
   *
   * @param uid - The unique ID of the filter.
   * @returns index of the referenced filter in the pipeline; -1 if not found.
   */
  _indexOfFilterWithId(uid: string | number | undefined): number {
    if (typeof uid === 'string' || typeof uid === 'number') {
      for (let idx = 0, len = this.filterPipeline.length; idx < len; idx += 1) {
        if (uid === this.filterPipeline[idx].uid) {
          return idx;
        }
      }
    }
    return -1;
  }

  /**
   * Implementation detail.
   * _addFilter() - Add the filter object to the end of view's filter pipeline and apply the filter to the resultset.
   *
   * @param filter - The filter object. Refer to applyFilter() for extra details.
   */
  _addFilter(filter: DynamicViewFilter): void {
    const wasFrozen = Object.isFrozen(this.filterPipeline);
    if (wasFrozen) {
      this.filterPipeline = this.filterPipeline.slice();
    }
    if (!this.collection.disableFreeze) {
      deepFreeze(filter);
    }
    this.filterPipeline.push(filter);
    if (wasFrozen) {
      Object.freeze(this.filterPipeline);
    }
    (this.resultset as any)[filter.type](filter.val);
  }

  /**
   * reapplyFilters() - Reapply all the filters in the current pipeline.
   *
   * @returns this DynamicView object, for further chain ops.
   */
  reapplyFilters(): this {
    this.resultset.reset();

    this.cachedresultset = null;
    if (this.options.persistent) {
      this.resultdata = [];
      this.resultsdirty = true;
    }

    const filters = this.filterPipeline;
    const wasFrozen = Object.isFrozen(filters);
    this.filterPipeline = [];

    for (let idx = 0, len = filters.length; idx < len; idx += 1) {
      this._addFilter(filters[idx]);
    }
    if (wasFrozen) {
      Object.freeze(this.filterPipeline);
    }

    if (this.sortFunction || this.sortCriteria || this.sortCriteriaSimple) {
      this.queueSortPhase();
    } else {
      this.queueRebuildEvent();
    }
    this.emit('filter');
    return this;
  }

  /**
   * applyFilter() - Adds or updates a filter in the DynamicView filter pipeline
   *
   * @param filter - A filter object to add to the pipeline.
   *    The object is in the format { 'type': filter_type, 'val', filter_param, 'uid', optional_filter_id }
   * @returns this DynamicView object, for further chain ops.
   */
  applyFilter(filter: DynamicViewFilter): this {
    const idx = this._indexOfFilterWithId(filter.uid);
    if (idx >= 0) {
      const wasFrozen = Object.isFrozen(this.filterPipeline);
      if (wasFrozen) {
        this.filterPipeline = this.filterPipeline.slice();
      }
      this.filterPipeline[idx] = filter;
      if (wasFrozen) {
        freeze(filter);
        Object.freeze(this.filterPipeline);
      }
      return this.reapplyFilters();
    }

    this.cachedresultset = null;
    if (this.options.persistent) {
      this.resultdata = [];
      this.resultsdirty = true;
    }

    this._addFilter(filter);

    if (this.sortFunction || this.sortCriteria || this.sortCriteriaSimple) {
      this.queueSortPhase();
    } else {
      this.queueRebuildEvent();
    }

    this.emit('filter');
    return this;
  }

  /**
   * applyFind() - Adds or updates a mongo-style query option in the DynamicView filter pipeline
   *
   * @param query - A mongo-style query object to apply to pipeline
   * @param uid - Optional: The unique ID of this filter, to reference it in the future.
   * @returns this DynamicView object, for further chain ops.
   */
  applyFind(query: LokiQuery<T> | any, uid?: string | number): this {
    this.applyFilter({
      type: 'find',
      val: query,
      uid: uid,
    });
    return this;
  }

  /**
   * applyWhere() - Adds or updates a javascript filter function in the DynamicView filter pipeline
   *
   * @param fun - A javascript filter function to apply to pipeline
   * @param uid - Optional: The unique ID of this filter, to reference it in the future.
   * @returns this DynamicView object, for further chain ops.
   */
  applyWhere(fun: (obj: LokiDocument<T>) => boolean, uid?: string | number): this {
    this.applyFilter({
      type: 'where',
      val: fun,
      uid: uid,
    });
    return this;
  }

  /**
   * removeFilter() - Remove the specified filter from the DynamicView filter pipeline
   *
   * @param uid - The unique ID of the filter to be removed.
   * @returns this DynamicView object, for further chain ops.
   */
  removeFilter(uid: string | number): this {
    const idx = this._indexOfFilterWithId(uid);
    if (idx < 0) {
      throw new Error(`Dynamic view does not contain a filter with ID: ${uid}`);
    }
    const wasFrozen = Object.isFrozen(this.filterPipeline);
    if (wasFrozen) {
      this.filterPipeline = this.filterPipeline.slice();
    }
    this.filterPipeline.splice(idx, 1);
    if (wasFrozen) {
      Object.freeze(this.filterPipeline);
    }
    this.reapplyFilters();
    return this;
  }

  /**
   * count() - returns the number of documents representing the current DynamicView contents.
   *
   * @returns The number of documents representing the current DynamicView contents.
   */
  count(): number {
    // in order to be accurate we will pay the minimum cost (and not alter dv state management)
    // recurring resultset data resolutions should know internally its already up to date.
    // for persistent data this will not update resultdata nor fire rebuild event.
    if (this.resultsdirty) {
      this.resultdata = this.resultset.data();
    }

    return this.resultset.count();
  }

  /**
   * data() - resolves and pending filtering and sorting, then returns document array as result.
   *
   * @param options - optional parameters to pass to resultset.data() if non-persistent
   * @param options.forceClones - Allows forcing the return of cloned objects even when
   *        the collection is not configured for clone object.
   * @param options.forceCloneMethod - Allows overriding the default or collection specified cloning method.
   *        Possible values include 'parse-stringify', 'jquery-extend-deep', 'shallow', 'shallow-assign'
   * @param options.removeMeta - Will force clones and strip $loki and meta properties from documents
   * @returns An array of documents representing the current DynamicView contents.
   */
  data(options?: ResultsetDataOptions): LokiDocument<T>[] {
    // using final sort phase as 'catch all' for a few use cases which require full rebuild
    if (this.sortDirty || this.resultsdirty) {
      this.performSortPhase({
        suppressRebuildEvent: true,
      });
    }
    return this.options.persistent ? this.resultdata : this.resultset.data(options);
  }

  /**
   * queueRebuildEvent() - When the view is not sorted we may still wish to be notified of rebuild events.
   *     This event will throttle and queue a single rebuild event when batches of updates affect the view.
   */
  queueRebuildEvent(): void {
    if (this.rebuildPending) {
      return;
    }
    this.rebuildPending = true;
    setTimeout(() => {
      if (this.rebuildPending) {
        this.rebuildPending = false;
        this.emit('rebuild', this);
      }
    }, this.options.minRebuildInterval);
  }

  /**
   * queueSortPhase : If the view is sorted we will throttle sorting to either :
   *    (1) passive - when the user calls data(), or
   *    (2) active - once they stop updating and yield js thread control
   */
  queueSortPhase(): void {
    // already queued? exit without queuing again
    if (this.sortDirty) {
      return;
    }
    this.sortDirty = true;
    if (this.options.sortPriority === 'active') {
      // active sorting... once they are done and yield js thread, run async performSortPhase()
      setTimeout(() => {
        this.performSortPhase();
      }, this.options.minRebuildInterval);
    } else {
      // must be passive sorting... since not calling performSortPhase (until data call), lets use queueRebuildEvent to
      // potentially notify user that data has changed.
      this.queueRebuildEvent();
    }
  }

  /**
   * performSortPhase() - invoked synchronously or asynchronously to perform final sort phase (if needed)
   */
  performSortPhase(options?: { suppressRebuildEvent?: boolean }): void {
    // async call to this may have been pre-empted by synchronous call to data before async could fire
    if (!this.sortDirty && !this.resultsdirty) {
      return;
    }

    options = options || {};

    if (this.sortDirty) {
      if (this.sortFunction) {
        this.resultset.sort(this.sortFunction);
      } else if (this.sortCriteria) {
        this.resultset.compoundsort(this.sortCriteria);
      } else if (this.sortCriteriaSimple) {
        this.resultset.simplesort(
          this.sortCriteriaSimple.propname,
          this.sortCriteriaSimple.options,
        );
      }

      this.sortDirty = false;
    }

    if (this.options.persistent) {
      // persistent view, rebuild local resultdata array
      this.resultdata = this.resultset.data();
      this.resultsdirty = false;
    }

    if (!options.suppressRebuildEvent) {
      this.emit('rebuild', this);
    }
  }

  /**
   * evaluateDocument() - internal method for (re)evaluating document inclusion.
   *    Called by : collection.insert() and collection.update().
   *
   * @param objIndex - index of document to (re)run through filter pipeline.
   * @param isNew - true if the document was just added to the collection.
   */
  evaluateDocument(objIndex: number, isNew?: boolean): void {
    // if no filter applied yet, the result 'set' should remain 'everything'
    if (!this.resultset.filterInitialized) {
      if (this.options.persistent) {
        this.resultdata = this.resultset.data();
      }
      // need to re-sort to sort new document
      if (this.sortFunction || this.sortCriteria || this.sortCriteriaSimple) {
        this.queueSortPhase();
      } else {
        this.queueRebuildEvent();
      }
      return;
    }

    const ofr = this.resultset.filteredrows;
    const oldPos = isNew ? -1 : ofr.indexOf(+objIndex);
    const oldlen = ofr.length;

    // creating a 1-element resultset to run filter chain ops on to see if that doc passes filters;
    // mostly efficient algorithm, slight stack overhead price (this function is called on inserts and updates)
    const evalResultset = new Resultset<T>(this.collection);
    evalResultset.filteredrows = [objIndex];
    evalResultset.filterInitialized = true;
    let filter: DynamicViewFilter;
    for (let idx = 0, len = this.filterPipeline.length; idx < len; idx++) {
      filter = this.filterPipeline[idx];
      (evalResultset as any)[filter.type](filter.val);
    }

    // not a true position, but -1 if not pass our filter(s), 0 if passed filter(s)
    const newPos = evalResultset.filteredrows.length === 0 ? -1 : 0;

    // wasn't in old, shouldn't be now... do nothing
    if (oldPos === -1 && newPos === -1) return;

    // wasn't in resultset, should be now... add
    if (oldPos === -1 && newPos !== -1) {
      ofr.push(objIndex);

      if (this.options.persistent) {
        this.resultdata.push(this.collection.data[objIndex]);
      }

      // need to re-sort to sort new document
      if (this.sortFunction || this.sortCriteria || this.sortCriteriaSimple) {
        this.queueSortPhase();
      } else {
        this.queueRebuildEvent();
      }

      return;
    }

    // was in resultset, shouldn't be now... delete
    if (oldPos !== -1 && newPos === -1) {
      if (oldPos < oldlen - 1) {
        ofr.splice(oldPos, 1);

        if (this.options.persistent) {
          this.resultdata.splice(oldPos, 1);
        }
      } else {
        ofr.length = oldlen - 1;

        if (this.options.persistent) {
          this.resultdata.length = oldlen - 1;
        }
      }

      // in case changes to data altered a sort column
      if (this.sortFunction || this.sortCriteria || this.sortCriteriaSimple) {
        this.queueSortPhase();
      } else {
        this.queueRebuildEvent();
      }

      return;
    }

    // was in resultset, should still be now... (update persistent only?)
    if (oldPos !== -1 && newPos !== -1) {
      if (this.options.persistent) {
        // in case document changed, replace persistent view data with the latest collection.data document
        this.resultdata[oldPos] = this.collection.data[objIndex];
      }

      // in case changes to data altered a sort column
      if (this.sortFunction || this.sortCriteria || this.sortCriteriaSimple) {
        this.queueSortPhase();
      } else {
        this.queueRebuildEvent();
      }

      return;
    }
  }

  /**
   * removeDocument() - internal function called on collection.delete()
   * @param objIndex - index of document to (re)run through filter pipeline.
   */
  removeDocument(objIndex: number | number[]): void {
    let idx: number;
    let rmidx: number;
    let rmlen: number;
    const rxo: Record<number, boolean> = {};
    const fxo: Record<number, boolean> = {};
    let adjels: number[] = [];
    const drs = this.resultset;
    const fr = this.resultset.filteredrows;
    let frlen = fr.length;

    // if no filter applied yet, the result 'set' should remain 'everything'
    if (!this.resultset.filterInitialized) {
      if (this.options.persistent) {
        this.resultdata = this.resultset.data();
      }
      // in case changes to data altered a sort column
      if (this.sortFunction || this.sortCriteria || this.sortCriteriaSimple) {
        this.queueSortPhase();
      } else {
        this.queueRebuildEvent();
      }
      return;
    }

    // if passed single index, wrap in array
    if (!Array.isArray(objIndex)) {
      objIndex = [objIndex];
    }

    rmlen = objIndex.length;
    // create intersection object of data indices to remove
    for (rmidx = 0; rmidx < rmlen; rmidx++) {
      rxo[objIndex[rmidx]] = true;
    }

    // pivot remove data indices into remove filteredrows indices and dump in hashobject
    for (idx = 0; idx < frlen; idx++) {
      if (rxo[fr[idx]]) fxo[idx] = true;
    }

    // if any of the removed items were in our filteredrows...
    if (Object.keys(fxo).length > 0) {
      // remove them from filtered rows
      this.resultset.filteredrows = this.resultset.filteredrows.filter((_di, idx) => !fxo[idx]);
      // if persistent...
      if (this.options.persistent) {
        // remove from resultdata
        this.resultdata = this.resultdata.filter((_obj, idx) => !fxo[idx]);
      }

      // and queue sorts
      if (this.sortFunction || this.sortCriteria || this.sortCriteriaSimple) {
        this.queueSortPhase();
      } else {
        this.queueRebuildEvent();
      }
    }

    // to remove holes, we need to 'shift down' indices, this filter function finds number of positions to shift
    const removed = objIndex;
    const filt = (idx: number) => (di: number) => di < drs.filteredrows[idx];

    frlen = drs.filteredrows.length;
    for (idx = 0; idx < frlen; idx++) {
      // grab subset of removed elements where data index is less than current filtered row data index;
      // use this to determine how many positions iterated remaining data index needs to be 'shifted down'
      adjels = removed.filter(filt(idx));
      drs.filteredrows[idx] -= adjels.length;
    }
  }

  /**
   * mapReduce() - data transformation via user supplied functions
   *
   * @param mapFunction - this function accepts a single document for you to transform and return
   * @param reduceFunction - this function accepts many (array of map outputs) and returns single value
   * @returns The output of your reduceFunction
   */
  mapReduce<M = any, R = any>(
    mapFunction: (obj: LokiDocument<T>, index: number, array: LokiDocument<T>[]) => M,
    reduceFunction: (array: M[]) => R,
  ): R {
    try {
      return reduceFunction(this.data().map(mapFunction));
    } catch (err) {
      throw err;
    }
  }
}
