// @ts-nocheck — spec héritée de LokiJS (inférence JS non typée) ; retirer lors du portage du module testé.
import { describe, expect, it } from 'vitest';
import { loki } from '../helpers/loki';

describe('dirtyIds', () => {
  it('doesnt do anything unless using incremental adapters', () => {
    var db = new loki('test.db');
    var coll = db.addCollection('coll');

    var doc1 = { foo: '1' };
    var doc2 = { foo: '2' };
    var doc3 = { foo: '3' };
    coll.insert([doc1, doc2, doc3]);
    doc2.bar = 'true';
    coll.update(doc2);
    coll.remove(doc3);

    expect(coll.dirtyIds).toEqual([]);
  });
  it('loki and db are incremental if adapter is incremental', () => {
    var adapter = { mode: 'incremental' };
    var db = new loki('test.db', { adapter: adapter });
    var coll = db.addCollection('coll');

    expect(db.isIncremental).toBe(true);
    expect(coll.isIncremental).toBe(true);
  });
  it('tracks inserts', () => {
    var adapter = { mode: 'incremental' };
    var db = new loki('test.db', { adapter: adapter });
    var coll = db.addCollection('coll');

    var doc1 = { foo: '1' };
    coll.insert(doc1);

    expect(coll.dirtyIds).toEqual([doc1.$loki]);
  });
  it('tracks updates', () => {
    var adapter = { mode: 'incremental' };
    var db = new loki('test.db', { adapter: adapter });
    var coll = db.addCollection('coll');

    var doc1 = { foo: '1' };
    coll.insert(doc1);
    doc1.change = 'true';
    coll.update(doc1);

    expect(coll.dirtyIds).toEqual([doc1.$loki, doc1.$loki]);
  });
  it('tracks deletes', () => {
    var adapter = { mode: 'incremental' };
    var db = new loki('test.db', { adapter: adapter });
    var coll = db.addCollection('coll');

    var doc1 = { foo: '1' };
    coll.insert(doc1);
    var id = doc1.$loki;
    coll.remove(doc1);

    expect(coll.dirtyIds).toEqual([id, id]);
  });
  it('tracks many changes', () => {
    var adapter = { mode: 'incremental' };
    var db = new loki('test.db', { adapter: adapter });
    var coll = db.addCollection('coll');

    var doc1 = { foo: '1' };
    var doc2 = { foo: '2' };
    var doc3 = { foo: '3' };
    coll.insert([doc1, doc2, doc3]);
    var doc3id = doc3.$loki;
    doc2.bar = 'true';
    coll.update(doc2);
    coll.remove(doc3);

    expect(coll.dirtyIds).toEqual([doc1.$loki, doc2.$loki, doc3id, doc2.$loki, doc3id]);
  });
});
