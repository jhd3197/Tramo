# @tramo/server

The long-running host for [tramo](https://github.com/jhd3197/tramo) workflows. It loads a catalog of workflows and:

- serves **webhook** endpoints (with HMAC verification),
- fires **cron** triggers on schedule (cron syntax *or* natural language),
- exposes a JSON **management API**,
- records **run history** with token/cost stats,
- persists **suspended runs** and resumes them on an **approval** decision,
- writes an optional **audit** trail and redacts secrets everywhere.

## Quick start (programmatic)

```ts
import { createTramoServer } from '@tramo/server';
import { combinePacks, BUILTIN_PACK, fileCheckpointStore, jsonlAuditSink } from '@tramo/runtime';
import GITHUB from '@tramo/github';
import myFlow from './my-flow.json' assert { type: 'json' };

const { executors, nodes } = combinePacks([BUILTIN_PACK, GITHUB]);

const server = createTramoServer({
  workflows: { myFlow },
  executors,
  nodes,                                  // used to find secret fields for redaction
  checkpoints: fileCheckpointStore('./state'),
  audit: jsonlAuditSink('./audit.jsonl'),
  apiKey: process.env.TRAMO_API_KEY,      // optional bearer auth on /api
});

const port = await server.listen(3000);
console.log(`listening on ${port}`);
```

## Quick start (CLI / Docker)

```bash
# CLI — built-in nodes only
npx tramo-server ./workflows --port 3000 --checkpoints ./state

# Docker
docker build -t tramo-server .
docker run -p 3000:3000 -v "$PWD/workflows:/workflows" -e TRAMO_API_KEY=secret tramo-server
```

## Management API

| Method & path | Purpose |
|---|---|
| `GET /api/health` | liveness + counts |
| `GET /api/stats` | dashboard aggregates (success rate, cost, tokens) |
| `GET /api/workflows` | list loaded workflows |
| `GET /api/workflows/:id` | one workflow doc |
| `POST /api/workflows/:id/run` | trigger a run (body = trigger payload) |
| `GET /api/runs` | recent runs (`?limit&workflowId&status`) |
| `GET /api/runs/:runId` | one run record |
| `POST /api/runs/:runId/replay` | re-run with the recorded trigger |
| `POST /api/runs/:runId/approve` | resume a suspended run (`{ approved, by?, key? }`) |
| `GET /api/approvals` | pending approvals |

Any path **not** under `/api` is dispatched to a matching `webhook-trigger`.

## Approvals

A workflow that hits an `approval-gate` returns `202` (webhook) or
`status: "suspended"` (API) with the pending requests. Resume it:

```bash
curl -X POST localhost:3000/api/runs/$RUN_ID/approve \
  -H "authorization: Bearer $TRAMO_API_KEY" \
  -d '{"approved": true, "by": "alice"}'
```

Suspended runs are persisted via the checkpoint store, so they survive a
restart — load the run and approve it after the process comes back up.
