# tramo-runtime

Executor for [tramo](../../) workflow documents.

This package contains:

- **`run(doc, registry, options)`** — topological-sort executor with per-node event stream.
- **`BUILTIN_EXECUTORS`** — implementations for the ten built-in node types defined in [`tramo`](../tramo).
- **Trigger drivers** — `manual()`, `webhook()`, `cron()` for the matching trigger nodes.

The editor that produces the doc lives in [`tramo`](../tramo).

See the [workspace README](../../README.md) for a quickstart and the full architecture.
