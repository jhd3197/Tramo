# @tramo/cli

CLI wrapper around [`@tramo/runtime`](../runtime). Run or validate a tramo workflow JSON file from a shell — on a server, in CI, or as a one-off on your laptop.

```bash
# Run a workflow with an optional trigger payload
npx tramo run workflow.json --trigger '{"user":"juan"}'

# Validate spec version + node types without running anything
npx tramo validate workflow.json
```

Exit codes follow the usual contract: `0` on success, `1` on failure (failed node, version mismatch, parse error, unknown node type, missing file).

The CLI uses the built-in node executors from `@tramo/runtime`. Custom executor packs and long-running triggers (webhooks, cron) are out of scope here — see the roadmap in the root README.
