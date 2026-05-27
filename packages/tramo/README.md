# tramo

Workflow-document-of-truth visual editor primitives — the editor half of the [tramo](../../) project.

This package contains:

- **Core**: `WorkflowDoc` type, typed `Patch` union, pure `applyPatch`, query helpers, `BUILTIN_NODES` definitions.
- **React** (`tramo/react`): `useWorkflow`, `WorkflowCanvas` (XYFlow wrapper), `NodeInspector`, `NodesPanel`, `RightRail`.
- **Agent** (`tramo/agent`): JSON Schema for the patch union, Anthropic/OpenAI tool specs, runtime validators.

The runtime that *executes* a doc lives in [`tramo-runtime`](../tramo-runtime).

See the [workspace README](../../README.md) for a quickstart and the full architecture.
