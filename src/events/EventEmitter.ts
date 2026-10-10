// Ported from LokiJS (src/lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
/**
 * LokiEventEmitter is a minimalist version of EventEmitter. It enables any
 * constructor that inherits EventEmitter to emit events and trigger
 * listeners that have been added to the event through the on(event, callback) method
 *
 * @constructor LokiEventEmitter
 */
export class LokiEventEmitter {
  /**
   * a hashmap, with each property being an array of callbacks
   */
  events!: { [eventName: string]: Array<(...args: any[]) => any> };

  /**
   * boolean determines whether or not the callbacks associated with each event
   * should happen in an async fashion or not
   * Default is false, which means events are synchronous
   */
  asyncListeners!: boolean;

  /**
   * on(eventName, listener) - adds a listener to the queue of callbacks associated to an event
   * @param eventName - the name(s) of the event(s) to listen to
   * @param listener - callback function of listener to attach
   * @returns the index of the callback in the array of listeners for a particular event
   */
  on(eventName: string | string[], listener: (...args: any[]) => any): any {
    let event: Array<(...args: any[]) => any>;

    if (Array.isArray(eventName)) {
      eventName.forEach((currentEventName) => {
        this.on(currentEventName, listener);
      });
      return listener;
    }

    event = this.events[eventName];
    if (!event) {
      event = this.events[eventName] = [];
    }
    event.push(listener);
    return listener;
  }

  /**
   * emit(eventName, data) - emits a particular event
   * with the option of passing optional parameters which are going to be processed by the callback
   * provided signatures match (i.e. if passing emit(event, arg0, arg1) the listener should take two parameters)
   * @param eventName - the name of the event
   * @param args - optional objects passed with the event
   */
  emit(eventName: string, ...args: any[]): void {
    if (eventName && this.events[eventName]) {
      if (this.events[eventName].length) {
        this.events[eventName].forEach((listener) => {
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

  /**
   * removeListener() - removes the listener at position 'index' from the event 'eventName'
   * @param eventName - the name(s) of the event(s) which the listener is attached to
   * @param listener - the listener callback function to remove from emitter
   */
  removeListener(eventName: string | string[], listener: (...args: any[]) => any): void {
    if (Array.isArray(eventName)) {
      eventName.forEach((currentEventName) => {
        this.removeListener(currentEventName, listener);
      });

      return;
    }

    if (this.events[eventName]) {
      const listeners = this.events[eventName];
      listeners.splice(listeners.indexOf(listener), 1);
    }
  }
}

// Alias of LokiEventEmitter.prototype.on
// addListener(eventName, listener) - adds a listener to the queue of callbacks associated to an event
export interface LokiEventEmitter {
  addListener: LokiEventEmitter['on'];
}

// Shared defaults live on the prototype, as in the original implementation.
LokiEventEmitter.prototype.events = {};
LokiEventEmitter.prototype.asyncListeners = false;
LokiEventEmitter.prototype.addListener = LokiEventEmitter.prototype.on;
