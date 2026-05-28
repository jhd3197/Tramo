# tramo

> Embed a workflow editor in your app. Pick the integrations you need. Get JSON out. Run it in JS or Python.

`tramo` is to workflows what [GrapesJS](https://grapesjs.com/) is to landing-page editors: a library you drop into a host app to ship a fully-configurable, agent-friendly automation builder. The document is plain JSON, every action is a typed patch, humans and LLMs edit through the same channel, and the same JSON runs in the browser, on a Node server, in a CLI job, or in Python.

```
 user clicks / drags        LLM tool-call emits
       │                            │
       ▼                            ▼
   ┌─────────────── apply_patch ───────────────┐
   │                                            │
   ▼                                            ▼
 WorkflowDoc (JSON)  ◄── one source of truth ──►  same doc
   │
   ▼
 tramo runtime  (JS or Python) — topo-sort + execute the graph
   │
   ▼
 nodeResults + per-node events
```

## Install

One package for the batteries-included setup:

```bash
npm install tramo react react-dom
```

```ts
import { Canvas, RightRail, useWorkflow } from 'tramo';
import { BUILTIN_REGISTRY, emptyDoc } from 'tramo/spec';
import { run, BUILTIN_EXECUTOR_REGISTRY } from 'tramo/runtime';
import 'tramo/styles.css';
```

Or pick exactly what you need (server-only, custom integrations, etc.):

```bash
npm install @tramo/spec @tramo/runtime    # no editor, no React
npm install @tramo/editor                  # the React canvas/inspector
npm install @tramo/cli                     # `tramo run` / `tramo validate` binaries
npm install @tramo/gmail @tramo/github     # the integration packs you actually use
```

## Pick your integrations

Every brand ships as a standalone npm package — `@tramo/gmail`, `@tramo/github`, `@tramo/telegram`, `@tramo/notion`, `@tramo/openai`, `@tramo/anthropic`, `@tramo/linear`, `@tramo/airtable`, `@tramo/stripe`, `@tramo/discord`. Install only the ones you want; nothing else ends up in your bundle.

```ts
import { BUILTIN_PACK, combinePacks } from 'tramo/runtime';
import GMAIL from '@tramo/gmail';
import GITHUB from '@tramo/github';
import TELEGRAM from '@tramo/telegram';

const { nodes, executors } = combinePacks([
  BUILTIN_PACK,    // http-request, js-transform, if, switch, loops, vars, sub-flows, …
  GMAIL,           // gmail-send, gmail-reply, gmail-search, …
  GITHUB,          // github-issue-create, github-pr-create, …
  TELEGRAM,        // telegram-send-message, telegram-send-photo, …
]);
```

The umbrella `tramo` package re-exports every brand pack from `tramo/integrations/<brand>` for convenience; tree-shaking drops unused brands from your bundle.

```ts
import GMAIL from 'tramo/integrations/gmail';
import GITHUB from 'tramo/integrations/github';
// `tramo/integrations/stripe` is never loaded → never shipped.
```

## Embed in your app

A complete embedded editor in under 30 lines:

```tsx
import { useState } from 'react';
import {
  Canvas, RightRail, useWorkflow,
} from 'tramo';
import {
  emptyDoc, BUILTIN_REGISTRY, type WorkflowDoc,
} from 'tramo/spec';
import { combinePacks, BUILTIN_PACK } from 'tramo/runtime';
import GMAIL from 'tramo/integrations/gmail';
import GITHUB from 'tramo/integrations/github';
import 'tramo/styles.css';

const { nodes: registry } = combinePacks([BUILTIN_PACK, GMAIL, GITHUB]);

export function MyEditor({ initial, onSave }: {
  initial: WorkflowDoc;
  onSave: (doc: WorkflowDoc) => void;
}) {
  const workflow = useWorkflow({
    registry,
    loadDoc: () => initial,
    saveDoc: onSave,           // ← receives WorkflowDoc on every change
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', height: '100vh' }}>
      <Canvas workflow={workflow} registry={registry} />
      <RightRail
        selection={workflow.selection}
        registry={registry}
        onApply={workflow.applyPatch}
        onClose={workflow.clearSelection}
        saveState={workflow.saveState}
      />
    </div>
  );
}
```

Pass `agent` props to the `RightRail` to enable the built-in LLM tab — your users can describe what they want and an agent patches the doc through exactly the same `apply_patch` surface a human would.

## The JSON contract

A `WorkflowDoc` is just JSON. This same payload moves between editor, JS runtime, Python runtime, file system, database — it's the *only* portable thing in tramo.

```jsonc
{
  "version": 1,
  "nodes": [
    {
      "id": "n_uz1c4c9y0r",
      "type": "manual-trigger",
      "label": "Run with sample user",
      "config": { "payload": "{\"user\":\"jhd3197\"}" }
    },
    {
      "id": "n_a1b2c3d4e5",
      "type": "http-request",
      "label": "Fetch GitHub user",
      "config": {
        "url": "https://api.github.com/users/{{user}}",
        "method": "GET",
        "timeoutMs": 8000
      }
    },
    {
      "id": "n_5cm3uymovp",
      "type": "gmail-send",
      "config": {
        "to": "team@example.com",
        "subject": "{{steps.fetch_github_user.name}} hit {{steps.fetch_github_user.followers}} followers",
        "body": "Profile: {{steps.fetch_github_user.html_url}}"
      }
    }
  ],
  "edges": [
    { "id": "e_aa11bb22cc", "source": "n_uz1c4c9y0r", "target": "n_a1b2c3d4e5" },
    { "id": "e_dd33ee44ff", "source": "n_a1b2c3d4e5", "target": "n_5cm3uymovp" }
  ],
  "meta": {}
}
```

Notice what's *not* in the doc: no node positions, no canvas state, no editor cache. Positions are derived from the DAG by the layout engine — the same JSON renders identically across editors.

## Run the same JSON anywhere

### In JavaScript

```ts
import { run, BUILTIN_EXECUTOR_REGISTRY } from 'tramo/runtime';

const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY, {
  trigger: { user: 'jhd3197' },
  onEvent: (e) => console.log(e),
});
```

### From the shell

```bash
npx @tramo/cli run workflow.json --trigger '{"user":"jhd3197"}'
npx @tramo/cli validate workflow.json
```

Exit codes are CI-friendly: `0` on success, `1` on parse / version / node failure.

### In Python (sibling runtime)

```python
from tramo import run_workflow, load_doc

doc = load_doc("workflow.json")
result = run_workflow(doc, trigger={"user": "jhd3197"})
```

`tramo-py` consumes the same `WorkflowDoc` JSON the JS editor emits. Same spec, same node ids, same `steps.*` semantics — different host language.

## Cross-node references

Every node's output is published to a per-run `steps` map keyed by both its id and a slug derived from its label. Templates and JS expressions can read any *already-completed* upstream step, not just the immediate parent.

```text
{{steps.fetch_github_user.followers}}    ← in any template field
steps.fetch_github_user.followers >= 10  ← in a JS condition
```

Renaming a step rewrites downstream references automatically; id-keyed lookups (`steps.n_uz1c4c9y0r.x`) keep working unconditionally.

## Built-in nodes

| Category | Nodes |
|---|---|
| **trigger** | `manual-trigger`, `webhook-trigger`, `cron-trigger` |
| **action** | `http-request`, `http-respond`, `mcp-tool-call`, `delay`, `log` |
| **transform** | `js-transform`, `template`, `json-parse`, `json-stringify` |
| **logic** | `if`, `switch`, `merge` |
| **loops** | `for-each` (inline body), `loop-start` / `loop-end` (subgraph body) |
| **state** | `set-var`, `increment-var`, `append-var` (the per-run `vars` map) |
| **sub-flow** | `flow-input`, `flow-output`, `call-flow` (recursive workflow invocation) |
| **ai** | `ai-prompt` (Anthropic / OpenAI / mock via direct HTTP) |

Plus brand operations from every installed `@tramo/<brand>` pack (62 operations across the 10 first-party brands).

## Custom node packs

A `NodePack` bundles a `NodeDefinition` (editor metadata) with its matching `NodeExecutor` (runtime behaviour) as a single distributable unit. Every brand pack uses the same API:

```ts
import type { NodeDefinition } from 'tramo/spec';
import { defineNodePack, type NodeExecutor } from 'tramo/runtime';

const definition: NodeDefinition = {
  id: 'uppercase',
  name: 'Uppercase',
  category: 'transform',
  icon: 'Type',
  inputs: [{ key: 'in', label: 'In', type: 'string' }],
  outputs: [{ key: 'out', label: 'Out', type: 'string' }],
  fields: [],
};

const executor: NodeExecutor = {
  id: 'uppercase',
  execute: (ctx) => ({ out: String(ctx.inputs.in ?? '').toUpperCase() }),
};

export default defineNodePack({
  id: 'example-uppercase',
  name: 'Uppercase example pack',
  version: '0.1.0',
  entries: [{ definition, executor }],
});
```

`defineNodePack` validates the bundle at construction time. `combinePacks` throws on cross-pack id collisions — silent shadowing is never allowed; to replace a built-in, omit it from your `BUILTIN_PACK` and substitute deliberately.

## MCP server import

Any MCP server can be imported as a tile in the integration picker. The editor introspects the server's tool list and synthesises a node definition per tool; the runtime dispatches calls via JSON-RPC under the `mcp-tool-call:<server>:<tool>` id. Servers persist in `WorkflowDoc.meta.mcpServers` so the same import follows the doc.

## Agent integration

```ts
import {
  buildPatchToolSpec, validatePatch,
  formatDocContext, TWEAK_SYSTEM_PROMPT,
} from 'tramo/agent';
import { applyPatch } from 'tramo/spec';
import Anthropic from '@anthropic-ai/sdk';

const tools = buildPatchToolSpec(registry);
const client = new Anthropic();
const response = await client.messages.create({
  model: 'claude-opus-4-7',
  max_tokens: 1024,
  system: `${TWEAK_SYSTEM_PROMPT}\n\n${formatDocContext(doc)}`,
  tools: [tools.anthropic],
  messages: [{ role: 'user', content: 'Add a Telegram notification after the If on the no branch.' }],
});

for (const block of response.content) {
  if (block.type === 'tool_use' && block.name === 'apply_patch') {
    doc = applyPatch(doc, validatePatch(block.input)).doc;
  }
}
```

The schema generated by `buildPatchToolSpec(registry)` constrains `node.type` to ids the registry actually knows — the model can only insert nodes you've registered, and node configs are schema-validated against each definition's `fields`.

## Packages

| Package | Role |
|---|---|
| **`tramo`** | Umbrella meta-package. Install this for the batteries-included setup — pulls editor + spec + runtime + every first-party brand pack and exposes them via subpath exports (`tramo/react`, `tramo/spec`, `tramo/runtime`, `tramo/agent`, `tramo/integrations/<brand>`). |
| **`@tramo/spec`** | The wire contract. Doc model, typed `Patch` union, pure utilities (`applyPatch`, `topoSort`, `buildStepSlugMap`, …), and the built-in node registry. Zero runtime deps beyond `nanoid`. |
| **`@tramo/editor`** | The React editor. `Canvas`, `NodeInspector`, `RightRail`, `useWorkflow`, `AgentChat`, plus the `tramo/agent` JSON-Schema/tool-spec emitters. |
| **`@tramo/runtime`** | Reference TypeScript executor — `run(doc, registry, options)`, `BUILTIN_EXECUTOR_REGISTRY` matching the editor's built-ins, trigger drivers, NodePack helpers (`defineNodePack`, `combinePacks`). |
| **`@tramo/cli`** | `tramo run` / `tramo validate` binaries for executing workflow JSON from a shell, CI, or `cron`. |
| **`@tramo/gmail`** etc. | Per-brand NodePacks. 10 first-party brands. Each one ships independently; install only what you use. |

The split exists because the *spec* — what a tramo workflow is on the wire — outlives any one runtime. A Python runtime, a CLI, or a future hosted runner all consume the same `@tramo/spec` package the browser editor emits.

## Design principles

- **Doc = JSON.** No proprietary scene graph, no positions baked in, no schema migrations buried in the library. The JSON you save is the JSON the editor mutates.
- **Spec / editor / runtime split.** The spec is the contract; the editor and runtime each depend on the spec, never on each other. Swap in a different runtime (Node CLI, Python, hosted) without touching the editor.
- **Agent-native.** Every patch maps 1:1 to an LLM tool-call; humans and agents go through the same surface.
- **Opt-in integrations.** Brand operations are separate npm packages. A Lambda function that only ships `@tramo/spec + @tramo/runtime + @tramo/gmail` is ~50KB total.
- **No silent shadowing.** Pack id collisions throw; replacing a built-in is always deliberate.

## Roadmap

### Portable runtimes
- **`tramo-py`** — Python sibling. Same `@tramo/spec` JSON, parallel executor implementations of every built-in node. Cross-node `steps.*` and sub-flow trio still being ported.
- **`@tramo/server`** — long-running host with webhook listener + cron scheduler so `webhook-trigger` / `cron-trigger` work outside the browser.

### Executor improvements
- Parallel execution within a topological layer.
- Per-node retry / backoff config.
- Streaming variant of `run()` (yields events as they happen).
- Persistent workflow state for long-running runs (resume after crash).

### Shipped
- ✅ Cross-node references via per-run `steps.<slug-or-id>.path`, surfaced in the var picker, rewritten on rename.
- ✅ Sub-flow trio (`flow-input` / `flow-output` / `call-flow`) for composing workflows.
- ✅ Switch node with dynamic ports; `for-each` (inline) and `loop-start`/`loop-end` (subgraph) loop constructs.
- ✅ Per-run `vars` map mutated by `set-var` / `increment-var` / `append-var`.
- ✅ MCP server import — tiles + tools become first-class nodes.
- ✅ Brand integration packs — 10 first-party brands, 62 operations.
- ✅ Webhook + cron triggers; `http-respond` for shaping HTTP responses.
- ✅ Own canvas engine — no XYFlow dep; auto-layout from the DAG.
- ✅ Multi-output branches (If `yes`/`no`, switch cases).
- ✅ Per-node `runAfter` policy (`on-success` / `on-error` / `always`).
- ✅ Node-pack convention — `defineNodePack`, `combinePacks`; built-ins flow through the same API.
- ✅ `@tramo/cli` — `tramo run` / `tramo validate`.

## Develop

```bash
npm install
npm run build       # all packages
npm test            # vitest across all packages
npm run demo        # → http://127.0.0.1:5181
```

## Inspiration

- [GrapesJS](https://grapesjs.com/) — embeddable visual editor; same shape, different domain.
- [htmlstudio](https://github.com/jhd3197/htmlstudio) — the document-of-truth + typed-patch pattern.
- [n8n](https://n8n.io/) / [Zapier](https://zapier.com/) — the workflow product space.

## License

MIT © Juan Denis
