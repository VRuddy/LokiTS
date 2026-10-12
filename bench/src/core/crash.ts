import { MACRO_SCENARIOS, QUERY_SCENARIOS } from './memory-scenarios.ts';
import { PERSISTENCE_SCENARIOS } from './persistence-scenarios.ts';
import { errorRow, type Family, type ResultRow } from './results.ts';

export function scenarioNames(family: Family): string[] {
  return family === 'memory'
    ? [...QUERY_SCENARIOS.map((s) => s.name), ...MACRO_SCENARIOS]
    : [...PERSISTENCE_SCENARIOS];
}

// One error row per scenario and size, so a crash shows up in every table it should have filled.
export function crashRows(
  family: Family,
  engine: string,
  env: string,
  sizes: number[],
  message: string,
): ResultRow[] {
  return sizes.flatMap((size) =>
    scenarioNames(family).map((scenario) =>
      errorRow({ family, scenario, size, engine, env }, new Error(`crashed: ${message}`)),
    ),
  );
}
