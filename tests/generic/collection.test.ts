// @ts-nocheck — spec héritée de LokiJS (inférence JS non typée) ; retirer lors du portage du module testé.
import { describe, expect, it } from 'vitest';
import { loki } from '../helpers/loki';

describe('collection', () => {
  it('collection rename works', () => {
    var db = new loki('test.db');
    var coll = db.addCollection('coll1');

    var result = db.getCollection('coll1');
    expect(result.name).toEqual('coll1');

    db.renameCollection('coll1', 'coll2');
    result = db.getCollection('coll1');
    expect(result).toBeNull();
    result = db.getCollection('coll2');
    expect(result.name).toEqual('coll2');
  });

  it('works', () => {
    // Breaking change : Collection est une classe ES, le sous-classage ES5
    // (`Collection.apply(this, args)`) n'est plus possible ; on utilise `extends`.
    class SubclassedCollection extends loki.Collection {
      extendedMethod() {
        return this.name.toUpperCase();
      }
    }
    var coll = new SubclassedCollection('users', {});

    expect(coll != null).toBe(true);
    expect('users'.toUpperCase()).toEqual(coll.extendedMethod());
    coll.insert({
      name: 'joe',
    });
    expect(coll.data.length).toEqual(1);
  });

  it('findAndUpdate works', () => {
    var db = new loki('test.db');
    var coll = db.addCollection('testcoll');
    coll.insert([
      { a: 3, b: 3 },
      { a: 6, b: 7 },
      { a: 1, b: 2 },
      { a: 7, b: 8 },
      { a: 6, b: 4 },
    ]);

    coll.findAndUpdate({ a: 6 }, (obj) => {
      obj.b += 1;
    });

    var result = coll.chain().find({ a: 6 }).simplesort('b').data();
    expect(result.length).toEqual(2);
    expect(result[0].b).toEqual(5);
    expect(result[1].b).toEqual(8);
  });

  it('findAndRemove works', () => {
    var db = new loki('test.db');
    var coll = db.addCollection('testcoll');
    coll.insert([
      { a: 3, b: 3 },
      { a: 6, b: 7 },
      { a: 1, b: 2 },
      { a: 7, b: 8 },
      { a: 6, b: 4 },
    ]);

    coll.findAndRemove({ a: 6 });

    expect(coll.data.length).toEqual(3);

    var result = coll.chain().find().simplesort('b').data();
    expect(result.length).toEqual(3);
    expect(result[0].b).toEqual(2);
    expect(result[1].b).toEqual(3);
    expect(result[2].b).toEqual(8);
  });

  it('removeWhere works', () => {
    var db = new loki('test.db');
    var coll = db.addCollection('testcoll');
    coll.insert([
      { a: 3, b: 3 },
      { a: 6, b: 7 },
      { a: 1, b: 2 },
      { a: 7, b: 8 },
      { a: 6, b: 4 },
    ]);

    coll.removeWhere((obj) => obj.a === 6);

    expect(coll.data.length).toEqual(3);

    var result = coll.chain().find().simplesort('b').data();
    expect(result.length).toEqual(3);
    expect(result[0].b).toEqual(2);
    expect(result[1].b).toEqual(3);
    expect(result[2].b).toEqual(8);
  });

  it('removeBatch works', () => {
    var db = new loki('test.db');
    var coll = db.addCollection('testcoll');
    coll.insert([
      { a: 3, b: 3 },
      { a: 6, b: 7 },
      { a: 1, b: 2 },
      { a: 7, b: 8 },
      { a: 6, b: 4 },
    ]);

    // remove by sending array of docs to remove()
    var results = coll.find({ a: 6 });
    expect(results.length).toEqual(2);

    coll.remove(results);
    expect(coll.data.length).toEqual(3);

    results = coll.chain().find().simplesort('b').data();
    expect(results.length).toEqual(3);
    expect(results[0].b).toEqual(2);
    expect(results[1].b).toEqual(3);
    expect(results[2].b).toEqual(8);

    // now repeat but send $loki id array to remove()
    coll.clear();
    coll.insert([
      { a: 3, b: 3 },
      { a: 6, b: 7 },
      { a: 1, b: 2 },
      { a: 7, b: 8 },
      { a: 6, b: 4 },
    ]);
    results = coll.find({ a: 6 }).map((obj) => obj.$loki);
    expect(results.length).toEqual(2);
    coll.remove(results);
    results = coll.chain().find().simplesort('b').data();
    expect(results.length).toEqual(3);
    expect(results[0].b).toEqual(2);
    expect(results[1].b).toEqual(3);
    expect(results[2].b).toEqual(8);
  });

  it('updateWhere works', () => {
    var db = new loki('test.db');
    var coll = db.addCollection('testcoll');
    coll.insert([
      { a: 3, b: 3 },
      { a: 6, b: 7 },
      { a: 1, b: 2 },
      { a: 7, b: 8 },
      { a: 6, b: 4 },
    ]);

    // guess we need to return object for this to work
    coll.updateWhere(
      (fobj) => fobj.a === 6,
      (obj) => {
        obj.b += 1;
        return obj;
      },
    );

    var result = coll.chain().find({ a: 6 }).simplesort('b').data();
    expect(result.length).toEqual(2);
    expect(result[0].b).toEqual(5);
    expect(result[1].b).toEqual(8);
  });

  // coll.mode(property) should return single value of property which occurs most in collection
  // if more than one value 'ties' it will just pick one
  it('mode works', () => {
    var db = new loki('test.db');
    var coll = db.addCollection('testcoll');
    coll.insert([
      { a: 3, b: 3 },
      { a: 6, b: 7 },
      { a: 1, b: 2 },
      { a: 7, b: 8 },
      { a: 6, b: 4 },
    ]);

    // seems mode returns string so loose equality
    var result = coll.mode('a') == 6;

    expect(result).toEqual(true);
  });

  it('single inserts emit with meta when async listeners false', () => {
    var db = new loki('test.db');
    var coll = db.addCollection('testcoll');

    // listen for insert events to validate objects
    coll.on('insert', (obj) => {
      expect(Object.hasOwn(obj, 'a')).toEqual(true);
      expect([3, 6, 1, 7, 5].indexOf(obj.a)).toBeGreaterThan(-1);

      switch (obj.a) {
        case 3:
          expect(obj.b).toEqual(3);
          break;
        case 6:
          expect(obj.b).toEqual(7);
          break;
        case 1:
          expect(obj.b).toEqual(2);
          break;
        case 7:
          expect(obj.b).toEqual(8);
          break;
        case 5:
          expect(obj.b).toEqual(4);
          break;
      }

      expect(Object.hasOwn(obj, '$loki')).toEqual(true);
      expect(Object.hasOwn(obj, 'meta')).toEqual(true);
      expect(Object.hasOwn(obj.meta, 'revision')).toEqual(true);
      expect(Object.hasOwn(obj.meta, 'created')).toEqual(true);
      expect(Object.hasOwn(obj.meta, 'version')).toEqual(true);
      expect(obj.meta.revision).toEqual(0);
      expect(obj.meta.version).toEqual(0);
      expect(obj.meta.created).toBeGreaterThan(0);
    });

    coll.insert({ a: 3, b: 3 });
    coll.insert({ a: 6, b: 7 });
    coll.insert({ a: 1, b: 2 });
    coll.insert({ a: 7, b: 8 });
    coll.insert({ a: 5, b: 4 });
  });

  it('single inserts (with clone) emit meta and return instances correctly', () => {
    var db = new loki('test.db');
    var coll = db.addCollection('testcoll', { clone: true });

    // listen for insert events to validate objects
    coll.on('insert', (obj) => {
      expect(Object.hasOwn(obj, 'a')).toEqual(true);
      expect([3, 6, 1, 7, 5].indexOf(obj.a)).toBeGreaterThan(-1);

      switch (obj.a) {
        case 3:
          expect(obj.b).toEqual(3);
          break;
        case 6:
          expect(obj.b).toEqual(7);
          break;
        case 1:
          expect(obj.b).toEqual(2);
          break;
        case 7:
          expect(obj.b).toEqual(8);
          break;
        case 5:
          expect(obj.b).toEqual(4);
          break;
      }

      expect(Object.hasOwn(obj, '$loki')).toEqual(true);
      expect(Object.hasOwn(obj, 'meta')).toEqual(true);
      expect(Object.hasOwn(obj.meta, 'revision')).toEqual(true);
      expect(Object.hasOwn(obj.meta, 'created')).toEqual(true);
      expect(Object.hasOwn(obj.meta, 'version')).toEqual(true);
      expect(obj.meta.revision).toEqual(0);
      expect(obj.meta.version).toEqual(0);
      expect(obj.meta.created).toBeGreaterThan(0);
    });

    var i1 = coll.insert({ a: 3, b: 3 });
    coll.insert({ a: 6, b: 7 });
    coll.insert({ a: 1, b: 2 });
    coll.insert({ a: 7, b: 8 });
    coll.insert({ a: 5, b: 4 });

    // verify that the objects returned from an insert are clones by tampering with values
    i1.b = 9;
    var result = coll.findOne({ a: 3 });
    expect(result.b).toEqual(3);
  });

  it('batch inserts emit with meta', () => {
    var db = new loki('test.db');
    var coll = db.addCollection('testcoll');

    // listen for insert events to validate objects
    coll.on('insert', (objs) => {
      expect(Array.isArray(objs)).toEqual(true);
      expect(objs.length).toEqual(5);

      expect(objs[0].b).toEqual(3);
      expect(objs[1].b).toEqual(7);
      expect(objs[2].b).toEqual(2);
      expect(objs[3].b).toEqual(8);
      expect(objs[4].b).toEqual(4);

      expect(Object.hasOwn(objs[0], '$loki')).toEqual(true);
      expect(Object.hasOwn(objs[1], '$loki')).toEqual(true);
      expect(Object.hasOwn(objs[2], '$loki')).toEqual(true);
      expect(Object.hasOwn(objs[3], '$loki')).toEqual(true);
      expect(Object.hasOwn(objs[4], '$loki')).toEqual(true);

      expect(Object.hasOwn(objs[0], 'meta')).toEqual(true);
      expect(Object.hasOwn(objs[1], 'meta')).toEqual(true);
      expect(Object.hasOwn(objs[2], 'meta')).toEqual(true);
      expect(Object.hasOwn(objs[3], 'meta')).toEqual(true);
      expect(Object.hasOwn(objs[4], 'meta')).toEqual(true);

      expect(Object.hasOwn(objs[0].meta, 'revision')).toEqual(true);
      expect(Object.hasOwn(objs[0].meta, 'created')).toEqual(true);
      expect(Object.hasOwn(objs[0].meta, 'version')).toEqual(true);
      expect(objs[0].meta.revision).toEqual(0);
      expect(objs[0].meta.version).toEqual(0);
      expect(objs[0].meta.created).toBeGreaterThan(0);
    });

    coll.insert([
      { a: 3, b: 3 },
      { a: 6, b: 7 },
      { a: 1, b: 2 },
      { a: 7, b: 8 },
      { a: 5, b: 4 },
    ]);
  });

  it('batch inserts emit with meta and return clones', () => {
    var db = new loki('test.db');
    var coll = db.addCollection('testcoll', { clone: true });

    // listen for insert events to validate objects
    coll.on('insert', (objs) => {
      expect(Array.isArray(objs)).toEqual(true);
      expect(objs.length).toEqual(5);

      expect(objs[0].b).toEqual(3);
      expect(objs[1].b).toEqual(7);
      expect(objs[2].b).toEqual(2);
      expect(objs[3].b).toEqual(8);
      expect(objs[4].b).toEqual(4);

      expect(Object.hasOwn(objs[0], '$loki')).toEqual(true);
      expect(Object.hasOwn(objs[1], '$loki')).toEqual(true);
      expect(Object.hasOwn(objs[2], '$loki')).toEqual(true);
      expect(Object.hasOwn(objs[3], '$loki')).toEqual(true);
      expect(Object.hasOwn(objs[4], '$loki')).toEqual(true);

      expect(Object.hasOwn(objs[0], 'meta')).toEqual(true);
      expect(Object.hasOwn(objs[1], 'meta')).toEqual(true);
      expect(Object.hasOwn(objs[2], 'meta')).toEqual(true);
      expect(Object.hasOwn(objs[3], 'meta')).toEqual(true);
      expect(Object.hasOwn(objs[4], 'meta')).toEqual(true);

      expect(Object.hasOwn(objs[0].meta, 'revision')).toEqual(true);
      expect(Object.hasOwn(objs[0].meta, 'created')).toEqual(true);
      expect(Object.hasOwn(objs[0].meta, 'version')).toEqual(true);
      expect(objs[0].meta.revision).toEqual(0);
      expect(objs[0].meta.version).toEqual(0);
      expect(objs[0].meta.created).toBeGreaterThan(0);
    });

    var obj1 = { a: 3, b: 3 };
    var result = coll.insert([
      obj1,
      { a: 6, b: 7 },
      { a: 1, b: 2 },
      { a: 7, b: 8 },
      { a: 5, b: 4 },
    ]);

    expect(Array.isArray(result)).toEqual(true);

    // tamper original (after insert)
    obj1.b = 99;
    // returned values should have been clones of original
    expect(result[0].b).toEqual(3);

    // internal data references should have benn clones of original
    var obj = coll.findOne({ a: 3 });
    expect(obj.b).toEqual(3);
  });
});
