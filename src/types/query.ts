export interface QueryOperators {
  $eq?: any;
  $aeq?: any;
  $ne?: any;
  $dteq?: any;
  $gt?: any;
  $gte?: any;
  $lt?: any;
  $lte?: any;
  $jgt?: any;
  $jgte?: any;
  $jlt?: any;
  $jlte?: any;
  $between?: [any, any];
  $jbetween?: [any, any];
  $in?: any[];
  $inSet?: Set<any>;
  $nin?: any[];
  $keyin?: object;
  $nkeyin?: object;
  $definedin?: object;
  $undefinedin?: object;
  $regex?: RegExp | [string, string] | string;
  $containsString?: string;
  $containsNone?: any;
  $containsAny?: any;
  $contains?: any;
  $elemMatch?: any;
  $type?: any;
  $finite?: boolean;
  $size?: any;
  $len?: any;
  $where?: (value: any) => boolean;
  $not?: any;
  $and?: any[];
  $or?: any[];
  $exists?: any;
  [op: string]: any;
}

export type LokiQuery<T = any> = {
  [K in keyof T]?: T[K] | QueryOperators;
} & {
  $and?: Array<LokiQuery<T>>;
  $or?: Array<LokiQuery<T>>;
  [field: string]: any;
};
