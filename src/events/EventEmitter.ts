// Ported from LokiJS (lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
/** Maps each event name to the tuple of arguments its listeners receive. */
export type LokiEventMap = Record<string, unknown[]>;

type Listener<A extends unknown[]> = (...args: A) => unknown;

/**
 * Minimal synchronous (or setTimeout-async) event emitter. Emitting an event that was never
 * registered in `events` throws, so subclasses pre-declare their event names in the constructor.
 */
export class LokiEventEmitter<E extends LokiEventMap = LokiEventMap> {
  events!: { [K in keyof E]?: Array<Listener<E[K]>> };

  /** When true, listeners run in a setTimeout instead of synchronously. */
  asyncListeners!: boolean;

  /** Adds a listener and returns it. An array of names attaches it to each event. */
  on<K extends keyof E & string>(eventName: K | K[], listener: Listener<E[K]>): Listener<E[K]> {
    if (Array.isArray(eventName)) {
      eventName.forEach((currentEventName) => {
        this.on(currentEventName, listener);
      });
      return listener;
    }

    let event = this.events[eventName];
    if (!event) {
      event = this.events[eventName] = [];
    }
    event.push(listener);
    return listener;
  }

  /** Calls every listener of `eventName`; throws if the event is not defined. */
  emit<K extends keyof E & string>(eventName: K, ...args: E[K]): void {
    const listeners = eventName ? this.events[eventName] : undefined;
    if (listeners) {
      if (listeners.length) {
        listeners.forEach((listener) => {
          if (this.asyncListeners) {
            setTimeout(() => {
              listener.apply(this, args);
            }, 1);
          } else {
            listener.apply(this, args);
          }
        });
      }
    } else {
      throw new Error(`No event ${eventName} defined`);
    }
  }

  /** Removes a listener from one event, or from each of an array of events. */
  removeListener<K extends keyof E & string>(eventName: K | K[], listener: Listener<E[K]>): void {
    if (Array.isArray(eventName)) {
      eventName.forEach((currentEventName) => {
        this.removeListener(currentEventName, listener);
      });

      return;
    }

    const listeners = this.events[eventName];
    const position = listeners ? listeners.indexOf(listener) : -1;
    if (listeners && position !== -1) {
      listeners.splice(position, 1);
    }
  }
}

export interface LokiEventEmitter<E extends LokiEventMap = LokiEventMap> {
  addListener: LokiEventEmitter<E>['on'];
}

// Shared defaults live on the prototype, as in the original implementation.
LokiEventEmitter.prototype.events = {};
LokiEventEmitter.prototype.asyncListeners = false;
LokiEventEmitter.prototype.addListener = LokiEventEmitter.prototype.on;
