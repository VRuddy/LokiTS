import { beforeEach, describe, expect, it } from 'vitest';
import { loki } from '../helpers/loki';

// Variables implicites globales dans les specs Jasmine d'origine (mode sloppy) :
// déclarées ici car les modules ESM sont en mode strict.
let users: any;

describe('eventEmitter', () => {
  var db;

  beforeEach(() => {
    (db = new loki('test', {
      persistenceMethod: null,
    })),
      (users = db.addCollection('users', {
        asyncListeners: false,
      }));

    users.insert({
      name: 'joe',
    });
  });

  it('async', function testAsync() {
    expect(db.asyncListeners).toBe(false);
  });

  it('emit', () => {
    var index = db.on('test', function test(obj) {
      expect(obj).toEqual(42);
    });

    db.emit('test', 42);
    db.removeListener('test', index);

    expect(db.events['test'].length).toEqual(0);

    expect(function testEvent() {
      db.emit('testEvent');
    }).toThrow(new Error('No event testEvent defined'));
  });
});
