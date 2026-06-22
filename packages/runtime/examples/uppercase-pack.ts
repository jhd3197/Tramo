/**
 * Example node pack — adds one custom node that upper-cases its input.
 *
 * This file shows the minimum a third-party pack needs to ship:
 *   1. A `NodeDefinition` describing the UI surface (icon, ports, config
 *      fields). The editor renders the inspector from this.
 *   2. A `NodeExecutor` with the same `id`. The runtime calls `execute`
 *      when the node is reached during a run.
 *   3. A `defineNodePack` call that bundles them together with a pack
 *      id, name, and version.
 *
 * Consumers do this to load it alongside the built-ins:
 *
 *   import { BUILTIN_PACK, combinePacks } from '@tramo/runtime';
 *   import { UPPERCASE_PACK } from '@tramo/runtime/examples/uppercase-pack';
 *
 *   const { nodes, executors } = combinePacks([BUILTIN_PACK, UPPERCASE_PACK]);
 *   useWorkflow({ registry: nodes, ... });
 *   await run(doc, executors);
 */

import type { NodeDefinition } from '@tramo/spec';
import { defineNodePack, type NodeExecutor } from '../src/index.js';

const uppercaseDefinition: NodeDefinition = {
  id: 'uppercase',
  name: 'Uppercase',
  category: 'transform',
  description: 'Upper-case the string input.',
  icon: 'Type',
  color: '#a855f7',
  inputs: [{ key: 'in', label: 'In', type: 'string' }],
  outputs: [{ key: 'out', label: 'Out', type: 'string' }],
  fields: [],
};

const uppercaseExecutor: NodeExecutor = {
  id: 'uppercase',
  execute: (ctx) => ({ out: String(ctx.inputs.in ?? '').toUpperCase() }),
};

export const UPPERCASE_PACK = defineNodePack({
  id: 'example-uppercase',
  name: 'Uppercase example pack',
  version: '0.1.0',
  entries: [{ definition: uppercaseDefinition, executor: uppercaseExecutor }],
});
