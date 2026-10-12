import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { runMemory } from './core/memory-scenarios.ts';
import { NODE_MEMORY_ENGINES } from './registry/node.ts';

const { values } = parseArgs({
  options: {
    engine: { type: 'string' },
    family: { type: 'string' },
    sizes: { type: 'string' },
    scenarios: { type: 'string' },
    out: { type: 'string' },
    quick: { type: 'boolean', default: false },
  },
});

const sizes = (values.sizes ?? '10000').split(',').map(Number);
const scenarios = values.scenarios?.split(',');
const name = values.engine ?? '';

if (values.family === 'memory') {
  const load = NODE_MEMORY_ENGINES[name];
  if (!load) {
    throw new Error(`unknown memory engine ${name}`);
  }
  const output = await runMemory(await load(), {
    sizes,
    env: 'node',
    quick: values.quick,
    scenarios,
  });
  writeFileSync(values.out ?? '', JSON.stringify(output));
} else {
  throw new Error(`unknown family ${values.family}`);
}
