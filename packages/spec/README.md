# @tramo/spec

Pure-data contract for the tramo workflow ecosystem.

This package defines **what a tramo workflow is** on the wire. It contains:

- The `WorkflowDoc` / `WorkflowNode` / `WorkflowEdge` document types.
- The `Patch` union — the only legal way to mutate a doc.
- Pure document utilities: `applyPatch`, `topoSort`, `getIncomingEdges`, etc.
- The canonical `BUILTIN_NODES` registry — the IDs and config-field shapes every runtime keys on.
- `SPEC_VERSION` — bumped only on breaking changes.

It has zero React, zero `fetch`, zero Node-only deps. The editor (`tramo`) consumes it for typing and rendering; every runtime (`@tramo/runtime`, future `tramo-runtime-py`) consumes it for execution. Keeping the contract in one place is how the editor and the runtimes stay honest with each other.
