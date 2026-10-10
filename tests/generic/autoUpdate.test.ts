// @ts-nocheck — spec héritée de LokiJS (inférence JS non typée) ; retirer lors du portage du module testé.
import { describe, expect, it } from 'vitest';
import { loki } from '../helpers/loki';

describe('autoupdate', () => {
  it('auto updates inserted documents', () =>
    new Promise<void>((done) => {
      if (typeof Object.observe !== 'function') {
        done();
        return;
      }

      var coll = new loki.Collection('test', {
        unique: ['name'],
        autoupdate: true,
      });

      coll.insert({
        name: 'Jack',
      });

      var doc = coll.insert({
        name: 'Peter',
      });

      function change1() {
        coll.on('update', (target) => {
          expect(target).toBe(doc);

          change2();
        });
        doc.name = 'John';
      }

      function change2() {
        coll.on('error', (err) => {
          expect(err).toEqual(new Error('Duplicate key for property name: ' + doc.name));
          done();
        });
        doc.name = 'Jack';
      }

      change1();
    }));

  it('auto updates documents loaded from storage', () =>
    new Promise<void>((done) => {
      if (typeof Object.observe !== 'function') {
        done();
        return;
      }

      var db1 = new loki('autoupdate1.json'),
        db2 = new loki('autoupdate2.json');

      var coll = db1.addCollection('test', {
        unique: ['name'],
        autoupdate: true,
      });

      var originalDocs = coll.insert([
        {
          name: 'Jack',
        },
        {
          name: 'Peter',
        },
      ]);

      db2.loadJSON(db1.serialize());

      coll = db2.getCollection('test');

      var doc = coll.by('name', 'Peter');

      expect(coll.autoupdate).toBe(true);
      expect(doc).toEqual(originalDocs[1]);

      function change1() {
        coll.on('update', (target) => {
          expect(target).toBe(doc);

          change2();
        });
        doc.name = 'John';
      }

      function change2() {
        coll.on('error', (err) => {
          expect(err).toEqual(new Error('Duplicate key for property name: ' + doc.name));
          done();
        });
        doc.name = 'Jack';
      }

      change1();
    }));
});
