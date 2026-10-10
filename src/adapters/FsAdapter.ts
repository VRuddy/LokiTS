// Ported from LokiJS (src/lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
/**
 * A loki persistence adapter which persists using node fs module
 */
export class LokiFsAdapter {
  // biome-ignore lint/suspicious/noExplicitAny: node 'fs' module, may be unavailable
  fs!: any;

  constructor() {
    try {
      // `process.getBuiltinModule` (Node >= 20.16 / 22.3) fonctionne aussi dans le build ESM,
      // où `require` n'existe pas ; `require` reste le repli (CJS, bundlers).
      // biome-ignore lint/suspicious/noExplicitAny: accès dynamique à l'environnement hôte
      const proc = (globalThis as any).process;
      if (proc && typeof proc.getBuiltinModule === 'function') {
        this.fs = proc.getBuiltinModule('fs') ?? null;
      } else {
        this.fs = typeof require !== 'undefined' ? require('fs') : null;
      }
    } catch (e) {
      this.fs = null;
    }
  }

  /**
   * loadDatabase() - Load data from file, will throw an error if the file does not exist
   * @param dbname - the filename of the database to load
   * @param callback - the callback to handle the result
   */
  // biome-ignore lint/suspicious/noExplicitAny: callback receives data, Error or null
  loadDatabase(dbname: string, callback: (result: any) => void): void {
    // biome-ignore lint/suspicious/noExplicitAny: fs callback types
    this.fs.stat(dbname, (err: any, stats: any) => {
      if (!err && stats.isFile()) {
        this.fs.readFile(
          dbname,
          {
            encoding: 'utf8',
          },
          // biome-ignore lint/suspicious/noExplicitAny: fs callback types
          function readFileCallback(err: any, data: string) {
            if (err) {
              callback(new Error(err));
            } else {
              callback(data);
            }
          },
        );
      } else {
        callback(null);
      }
    });
  }

  /**
   * saveDatabase() - save data to file, will throw an error if the file can't be saved
   * might want to expand this to avoid dataloss on partial save
   * @param dbname - the filename of the database to load
   * @param dbstring - serialized database
   * @param callback - the callback to handle the result
   */
  // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
  saveDatabase(dbname: string, dbstring: string, callback: (err?: any) => void): void {
    const self = this;
    const tmpdbname = `${dbname}~`;
    // biome-ignore lint/suspicious/noExplicitAny: fs callback types
    this.fs.writeFile(tmpdbname, dbstring, function writeFileCallback(err: any) {
      if (err) {
        callback(new Error(err));
      } else {
        self.fs.rename(tmpdbname, dbname, callback);
      }
    });
  }

  /**
   * deleteDatabase() - delete the database file, will throw an error if the
   * file can't be deleted
   * @param dbname - the filename of the database to delete
   * @param callback - the callback to handle the result
   */
  // biome-ignore lint/suspicious/noExplicitAny: callback receives errors of any shape
  deleteDatabase(dbname: string, callback: (err?: any) => void): void {
    // biome-ignore lint/suspicious/noExplicitAny: fs callback types
    this.fs.unlink(dbname, function deleteDatabaseCallback(err: any) {
      if (err) {
        callback(new Error(err));
      } else {
        callback();
      }
    });
  }
}
