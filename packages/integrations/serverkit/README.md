# @tramo/serverkit

ServerKit panel integration pack for [tramo](https://github.com/jhd3197/tramo). 6 operations (list apps, get app, control app, deploy, run backup, send notification) + 1 webhook trigger.

```ts
import { combinePacks, BUILTIN_PACK } from '@tramo/runtime';
import SERVERKIT from '@tramo/serverkit';

const { nodes, executors } = combinePacks([BUILTIN_PACK, SERVERKIT]);
```

## Connection

Every action calls the panel REST API with an `X-API-Key` header. The base URL
and key are read from each node's config, falling back to environment variables:

| Config field | Env fallback        | Default                 |
| ------------ | ------------------- | ----------------------- |
| `baseUrl`    | `SERVERKIT_URL`     | `http://127.0.0.1:5000` |
| `apiKey`     | `SERVERKIT_API_KEY` | —                       |

When @tramo/server runs next to the panel, set `SERVERKIT_URL` and
`SERVERKIT_API_KEY` once and leave the per-node fields blank.

## Nodes

| Node id                            | REST call                              |
| ---------------------------------- | -------------------------------------- |
| `webhook-trigger:serverkit:event`  | inbound webhook (default `/sk/events`) |
| `serverkit:app-list`               | `GET /api/v1/apps`                     |
| `serverkit:app-get`                | `GET /api/v1/apps/<app>`               |
| `serverkit:app-control`            | `POST /api/v1/apps/<app>/<action>`     |
| `serverkit:app-deploy`             | `POST /api/v1/apps/<app>/deploy`       |
| `serverkit:backup-run`             | `POST /api/v1/backups`                 |
| `serverkit:notify-send`            | `POST /api/v1/notifications/send`      |
