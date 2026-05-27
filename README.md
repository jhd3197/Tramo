# tramo

> Workflow-document-of-truth visual editor + runtime. Node-based automation primitives — your own n8n/Zapier built on top of XYFlow, with the same patch-and-agent shape as [htmlstudio](https://github.com/jhd3197/htmlstudio).

`tramo` is what you get when you take htmlstudio's "HTML string is the source, every action is a typed patch, humans and LLMs edit through the same channel" pattern and apply it to node-based workflows instead of HTML pages.

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
| **`tramo`** | Doc model, typed `Patch` union, query helpers, `BUILTIN_NODES` definitions, React editor (`useWorkflow`, `WorkflowCanvas`, `NodeInspector`, `NodesPanel`, `RightRail`), `tramo/agent` JSON Schema + provider tool specs. |
| **`tramo-runtime`** | Executor (`run(doc, registry, options)`), `BUILTIN_EXECUTORS` matching the editor's built-in nodes, trigger drivers (manual / webhook / cron). |

Both packages live in this workspace; npm workspaces makes them resolve locally during dev.

## The pattern

Same as htmlstudio:

1. **One source of truth.** Here it's a `WorkflowDoc` JSON object — `{ version, nodes, edges, meta }`.
2. **Stable IDs** stamped on every node and edge so patches target them unambiguously (`n_xxxxxxxxxx`, `e_xxxxxxxxxx`).
3. **A small, typed `Patch` union** that covers every editable action — `add-node`, `update-node-config`, `move-node`, `remove-node`, `add-edge`, `remove-edge`, `set-full-doc`.
4. **Pure `applyPatch(doc, patch)`** returns a new doc. No in-place mutation.
5. **Same surface for humans and agents.** The editor produces patches when you drag/connect/edit. The `tramo/agent` layer exports a JSON Schema for the union plus Anthropic/OpenAI tool specs — an LLM can build or edit the workflow through exactly the same channel.

## Quick start

```bash
npm install
npm run build       # builds both packages
npm run demo        # → http://127.0.0.1:5181
```

The demo shows a draggable palette on the left, an XYFlow canvas in the middle, an inspector on the right, and a **Run** button that executes the current doc through `tramo-runtime` and streams per-node events into a log at the bottom.

## Core API (the editor side)

```ts
import {
  emptyDoc,
  applyPatch,
  applyPatches,
  newNodeId,
  newEdgeId,
  BUILTIN_REGISTRY,
  type Patch,
  type WorkflowDoc,
} from 'tramo';

let doc: WorkflowDoc = emptyDoc();

// Add a manual trigger
doc = applyPatch(doc, {
  kind: 'add-node',
  node: {
    id: newNodeId(),
    type: 'manual-trigger',
    position: { x: 80, y: 80 },
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
import '@xyflow/react/dist/style.css';
import {
  useWorkflow,
  WorkflowCanvas,
  NodesPanel,
  RightRail,
} from 'tramo/react';
import { BUILTIN_REGISTRY, emptyDoc } from 'tramo';
import { ReactFlowProvider } from '@xyflow/react';

export function Editor() {
  return (
    <ReactFlowProvider>
      <Inner />
    </ReactFlowProvider>
  );
}

function Inner() {
  const workflow = useWorkflow({
    registry: BUILTIN_REGISTRY,
    loadDoc: () => emptyDoc(),
    saveDoc: (doc) => console.log('persist', doc),
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 320px', height: '100vh' }}>
      <NodesPanel registry={BUILTIN_REGISTRY} />
      <WorkflowCanvas workflow={workflow} />
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
import { BUILTIN_REGISTRY } from 'tramo';
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
| logic | `if` | Routes input to `true` or `false` port based on a condition. |
| logic | `merge` | Combines fan-in inputs (object / array / first-non-null). |
| ai | `ai-prompt` | Anthropic / OpenAI / mock providers via direct HTTP — no SDK dep. |

Register more via `createRegistry([...])` on the editor and `createExecutorRegistry([...])` on the runtime — same id on both sides.

## Design principles

- **Doc = JSON.** No proprietary scene graph, no schema migrations baked into the library. The JSON you save is the JSON the editor mutates.
- **Agent-native.** Every patch maps 1:1 to an LLM tool-call; humans and agents go through the same surface.
- **Tiny core, opt-in layers.** Core has one runtime dep (`nanoid`). React and agent layers are independent imports.
- **Editor / runtime split.** You can ship the editor without Node-only deps (HTTP clients, schedulers); you can swap in a different runtime without touching the editor.

## Roadmap

- Parallel execution within a topological layer.
- Per-node retry / backoff config.
- Sub-workflows (a node whose `execute` runs another doc).
- Streaming variant of `run()` (yields events as they happen).
- Persistent workflow state for long-running runs (resume after crash).
- VS Code extension that opens `.tramo.json` files in the editor.

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
