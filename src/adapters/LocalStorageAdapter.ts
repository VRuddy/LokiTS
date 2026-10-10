// Ported from LokiJS (src/lokijs.js), MIT. Original author: Joe Minichino and LokiJS contributors.
import { localStorageAvailable } from '../utils/helpers';

/**
 * A loki persistence adapter which persists to web browser's local storage object
 */
export class LokiLocalStorageAdapter {
  /**
   * loadDatabase() - Load data from localstorage
   * @param dbname - the name of the database to load
   * @param callback - the callback to handle the result
   */
  loadDatabase(dbname: string, callback: (result: any) => void): void {
    if (localStorageAvailable()) {
      callback(localStorage.getItem(dbname));
    } else {
      callback(new Error('localStorage is not available'));
    }
  }

  /**
   * saveDatabase() - save data to localstorage, will throw an error if the file can't be saved
   * might want to expand this to avoid dataloss on partial save
   * @param dbname - the filename of the database to load
   * @param dbstring - serialized database
   * @param callback - the callback to handle the result
   */
  saveDatabase(dbname: string, dbstring: string, callback: (err: any) => void): void {
    if (localStorageAvailable()) {
      localStorage.setItem(dbname, dbstring);
      callback(null);
    } else {
      callback(new Error('localStorage is not available'));
    }
  }

  /**
   * deleteDatabase() - delete the database from localstorage, will throw an error if it
   * can't be deleted
   * @param dbname - the filename of the database to delete
   * @param callback - the callback to handle the result
   */
  deleteDatabase(dbname: string, callback: (err: any) => void): void {
    if (localStorageAvailable()) {
      localStorage.removeItem(dbname);
      callback(null);
    } else {
      callback(new Error('localStorage is not available'));
    }
  }
}
