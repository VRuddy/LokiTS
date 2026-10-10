export interface LokiMeta {
  revision?: number;
  created: number;
  version: number;
  updated?: number;
  [key: string]: any;
}

export type LokiDocument<T = any> = T & { $loki: number; meta: LokiMeta };
