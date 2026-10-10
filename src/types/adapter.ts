export interface LokiPersistenceAdapter {
  mode?: string;
  loadDatabase(dbname: string, callback: (value: any) => void): void;
  saveDatabase?(dbname: string, dbstring: any, callback: (err?: Error | null) => void): void;
  deleteDatabase?(dbname: string, callback: (data?: any) => void): void;
  exportDatabase?(dbname: string, dbref: any, callback: (err?: Error | null) => void): void;
  [key: string]: any;
}
