import { beforeEach, describe, expect, it } from 'vitest';
import { loki } from '../helpers/loki';

// Variables implicites globales dans les specs Jasmine d'origine (mode sloppy) :
// déclarées ici car les modules ESM sont en mode strict.
let db: any, directors: any, films: any;

describe('Staging and commits', () => {
  beforeEach(() => {
    (db = new loki('testJoins', {
      persistenceMethod: null,
    })),
      (directors = db.addCollection('directors')),
      (films = db.addCollection('films'));

    directors.insert([
      {
        name: 'Martin Scorsese',
        directorId: 1,
      },
      {
        name: 'Francis Ford Coppola',
        directorId: 2,
      },
      {
        name: 'Steven Spielberg',
        directorId: 3,
      },
      {
        name: 'Quentin Tarantino',
        directorId: 4,
      },
    ]);
  });

  it('work', () => {
    var stageName = 'tentative directors',
      newDirectorsName = 'Joel and Ethan Cohen',
      message = 'Edited Cohen brothers name';

    var cohen = directors.insert({
      name: 'Cohen Brothers',
      directorId: 5,
    });
    var new_cohen = directors.stage(stageName, cohen);
    new_cohen.name = newDirectorsName;
    expect(cohen.name).toEqual('Cohen Brothers');
    directors.commitStage(stageName, message);
    expect(directors.get(cohen.$loki).name).toEqual('Joel and Ethan Cohen');
    expect(directors.commitLog.filter((entry) => entry.message === message).length).toBe(1);
  });
});
