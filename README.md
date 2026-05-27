# tramo

> Workflow-document-of-truth visual editor + portable runtime. Node-based automation primitives with the same patch-and-agent shape as [htmlstudio](https://github.com/jhd3197/htmlstudio) — the doc is plain JSON, every action is a typed patch, and the same spec runs in the browser today and on servers tomorrow.

`tramo` is what you get when you take htmlstudio's "the document is the source of truth, every action is a typed patch, humans and LLMs edit through the same channel" pattern and apply it to node-based workflows instead of HTML pages.

```
 user clicks the canvas        LLM tool-call emits
     │                                │
     ▼                                ▼
   ┌───────────────── apply_patch ─────────────────┐
   │                                                │
   ▼                                                ▼
 WorkflowDoc (JSON)  ◄──── one source of truth ────►  the same doc
   │
   ▼
 tramo-runtime    ◄── topo-sort + execute the graph
   │
   ▼
 nodeResults + per-node events
```

## Packages

| Package | Role |
|---|---|
| **`tramo-spec`** | The wire contract. Doc model, typed `Patch` union, pure utilities (`applyPatch`, `topoSort`, …), and the canonical `BUILTIN_NODES` registry. Zero deps, runs anywhere. Bumping `SPEC_VERSION` is the only way to break the format. |
| **`tramo`** | The editor. React components (`Canvas`, `NodeInspector`, `NodeMenu`, `RightRail`, `useWorkflow`) and `tramo/agent` JSON Schema + provider tool specs. Depends on `tramo-spec`. |
| **`tramo-runtime`** | The reference TypeScript runtime — `run(doc, registry, options)`, `BUILTIN_EXECUTORS` matching the editor's built-in nodes, trigger drivers. Browser + Node + serverless. Depends on `tramo-spec` (no editor dep). |

All three live in this workspace; npm workspaces resolves them locally during dev.

The split exists because the *spec* — what a tramo workflow is on the wire — outlives any one runtime. A Python runtime, a CLI wrapper, or a future hosted runner all consume the same `tramo-spec` package the browser editor emits.

## The pattern

Same as htmlstudio:

1. **One source of truth.** Here it's a `WorkflowDoc` JSON object — `{ version, nodes, edges, meta }`.
2. **Stable IDs** stamped on every node and edge so patches target them unambiguously (`n_xxxxxxxxxx`, `e_xxxxxxxxxx`).
3. **A small, typed `Patch` union** that covers every editable action — `add-node`, `update-node-config`, `update-node`, `remove-node`, `add-edge`, `remove-edge`, `set-full-doc`. (No `move-node`: positions are auto-computed by the canvas from the DAG and are not stored on the doc.)
4. **Pure `applyPatch(doc, patch)`** returns a new doc. No in-place mutation.
5. **Same surface for humans and agents.** The editor produces patches when you drag/connect/edit. The `tramo/agent` layer exports a JSON Schema for the union plus Anthropic/OpenAI tool specs — an LLM can build or edit the workflow through exactly the same channel.

## Quick start

```bash
npm install
npm run build       # builds both packages
npm run demo        # → http://127.0.0.1:5181
```

The demo shows a node palette, the canvas (rendered by tramo's own canvas engine — no XYFlow), an inspector, and a **Run** button that executes the current doc through `tramo-runtime` and streams per-node events into a log at the bottom.

## Core API (the spec)

Everything you need to build, query, or validate a doc lives in `tramo-spec` — no React, no `fetch`, runs anywhere.

```ts
import {
  emptyDoc,
  applyPatch,
  applyPatches,
  newNodeId,
  newEdgeId,
  BUILTIN_REGISTRY,
  SPEC_VERSION,
  type Patch,
  type WorkflowDoc,
} from 'tramo-spec';

let doc: WorkflowDoc = emptyDoc();

// Add a manual trigger. Positions are derived by the canvas from the
// edge graph — there is no `position` field on the doc.
doc = applyPatch(doc, {
  kind: 'add-node',
  node: {
    id: newNodeId(),
    type: 'manual-trigger',
    config: { payload: '{"hello":"world"}' },
  },
}).doc;
```

## Running the workflow

```ts
import { run, BUILTIN_EXECUTOR_REGISTRY } from 'tramo-runtime';

const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY, {
  trigger: { user: 'juan' },
  onEvent: (e) => console.log(e),
});

if (result.ok) {
  console.log('Final results:', result.nodeResults);
}
```

## React editor

```tsx
import 'tramo/styles.css';
import { Canvas, RightRail, useWorkflow } from 'tramo/react';
import { BUILTIN_REGISTRY, emptyDoc } from 'tramo-spec';

export function Editor() {
  const workflow = useWorkflow({
    registry: BUILTIN_REGISTRY,
    loadDoc: () => emptyDoc(),
    saveDoc: (doc) => console.log('persist', doc),
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', height: '100vh' }}>
      <Canvas workflow={workflow} registry={BUILTIN_REGISTRY} />
      <RightRail
        selection={workflow.selection}
        registry={BUILTIN_REGISTRY}
        onApply={workflow.applyPatch}
        onClose={workflow.clearSelection}
        saveState={workflow.saveState}
      />
    </div>
  );
}
```

## Agent integration

`tramo/agent` ships everything you need to let an LLM build or edit workflows through the same patch surface:

```ts
import {
  buildPatchToolSpec,
  validatePatch,
  formatDocContext,
  TWEAK_SYSTEM_PROMPT,
} from 'tramo/agent';
import { BUILTIN_REGISTRY, applyPatch } from 'tramo-spec';
import Anthropic from '@anthropic-ai/sdk';

const tools = buildPatchToolSpec(BUILTIN_REGISTRY);

const client = new Anthropic();
const response = await client.messages.create({
  model: 'claude-opus-4-7',
  max_tokens: 1024,
  system: `${TWEAK_SYSTEM_PROMPT}\n\n${formatDocContext(doc)}`,
  tools: [tools.anthropic],
  messages: [{ role: 'user', content: 'Add a log node after the http-request.' }],
});

for (const block of response.content) {
  if (block.type === 'tool_use' && block.name === 'apply_patch') {
    const patch = validatePatch(block.input); // throws on shape mismatch
    doc = applyPatch(doc, patch).doc;
  }
}
```

The schema generated by `buildPatchToolSpec(registry)` constrains `node.type` to the registry's known ids, so the model can only insert types you've actually registered.

## Built-in nodes (v0.1)

| Category | Node | Notes |
|---|---|---|
| trigger | `manual-trigger` | Started by clicking Run; emits the configured payload. |
| trigger | `webhook-trigger` | HTTP endpoint registered by the webhook trigger driver. |
| trigger | `cron-trigger` | Fires on a 5-field cron expression. |
| action | `http-request` | Native `fetch`, JSON/text auto-decoding, timeout, error port. |
| action | `log` | Writes to the run-event logger; passes input through. |
| transform | `js-transform` | Runs a `Function`-body expression with `input` and `config` in scope. |
| transform | `template` | `{{path.to.value}}` interpolation against the input. |
| logic | `if` | Routes input to the `yes` or `no` port based on a condition. |
| logic | `merge` | Combines fan-in inputs (object / array / first-non-null). |
| ai | `ai-prompt` | Anthropic / OpenAI / mock providers via direct HTTP — no SDK dep. |

Register more via `createRegistry([...])` on the editor and `createExecutorRegistry([...])` on the runtime — same id on both sides.

## Design principles

- **Doc = JSON.** No proprietary scene graph, no schema migrations baked into the library. The JSON you save is the JSON the editor mutates.
- **Agent-native.** Every patch maps 1:1 to an LLM tool-call; humans and agents go through the same surface.
- **Tiny core, opt-in layers.** `tramo-spec` has one runtime dep (`nanoid`). React and agent layers ship as separate subpath exports.
- **Spec / editor / runtime split.** The spec is the contract; the editor and the runtime each depend on the spec, never on each other. Swap in a different runtime (Node CLI, future Python, hosted) without touching the editor.

## Roadmap

### Portable runtimes
A tramo doc is just JSON; the goal is for that JSON to run anywhere the user wants — not just in the browser tab where it was authored.

- **`tramo-runtime-node`** — thin CLI wrapper around `tramo-runtime`. `tramo run workflow.json --trigger '<json>'` for cron jobs, CI tasks, "drop on a box and run it" deployments. *Next up.*
- **`tramo-runtime-py`** — Python sibling of `tramo-runtime`. Same `tramo-spec` JSON, parallel executor implementations of every built-in node. Unlocks Lambda / Airflow / pandas-heavy users. *Under consideration; depends on demand.*
- **`tramo-runtime-server`** — long-running host with webhook listener + cron scheduler, so `webhook-trigger` and `cron-trigger` work outside the browser. *Later.*

### Executor improvements
- Parallel execution within a topological layer.
- Per-node retry / backoff config.
- Sub-workflows (a node whose `execute` runs another doc).
- Streaming variant of `run()` (yields events as they happen).
- Persistent workflow state for long-running runs (resume after crash).

### Spec & tooling
- Spec validator CLI (`tramo validate workflow.json`) — checks `SPEC_VERSION`, node types, edge endpoints, port keys.
- Node-type plugin convention so third-party node packs ship a definition + executor pair behind a single registry call.
- VS Code extension that opens `.tramo.json` files in the editor.

### Shipped
- ✅ `tramo-spec` extracted as the standalone wire contract, with `SPEC_VERSION` enforced by the runtime on every run.
- ✅ Own canvas engine — no XYFlow dependency; auto-layout from the DAG.
- ✅ Multi-output branches (`if` node's `yes`/`no` anchors).
- ✅ Per-node `runAfter` policy (`on-success` / `on-error` / `always`).

## Develop

```bash
npm install
npm run build              # tsc + sass across both packages
npm test                   # vitest across both packages
npm run demo               # → http://127.0.0.1:5181
```

## Inspiration

- [htmlstudio](https://github.com/jhd3197/htmlstudio) — same pattern, applied to HTML.
- [n8n](https://n8n.io/) / [Zapier](https://zapier.com/) — the workflow product space.
- [XYFlow / React Flow](https://reactflow.dev/) — the canvas.

## License

MIT © Juan Denis
