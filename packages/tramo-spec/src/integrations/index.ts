/**
 * Integration packs — aggregated.
 *
 * Each `*.ts` in this directory exports `{ DEFINITION, NODES }`. This file
 * collects them so `nodes.ts` can fold the operation nodes into BUILTIN_NODES
 * and surface the integrations array on the registry.
 *
 * To add a new integration: drop a new file in this folder following the
 * same shape, then add it to the imports below.
 */

import type { IntegrationDefinition, NodeDefinition } from '../types.js';

import * as github from './github.js';
import * as discord from './discord.js';
import * as telegram from './telegram.js';
import * as notion from './notion.js';
import * as gmail from './gmail.js';
import * as openai from './openai.js';

interface Pack {
  DEFINITION: IntegrationDefinition;
  NODES: NodeDefinition[];
}

const PACKS: Pack[] = [github, discord, telegram, notion, gmail, openai];

export const BUILTIN_INTEGRATIONS: IntegrationDefinition[] = PACKS.map((p) => p.DEFINITION);

export const BUILTIN_INTEGRATION_NODES: NodeDefinition[] = PACKS.flatMap((p) => p.NODES);
