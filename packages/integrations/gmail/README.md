# @tramo/gmail

Gmail integration pack for [tramo](https://github.com/jhd3197/tramo). Adds 7 Gmail operations — send, reply, draft, search, get, trash, modify labels — to a tramo workflow editor / runtime.

```ts
import { combinePacks, BUILTIN_PACK } from '@tramo/runtime';
import GMAIL from '@tramo/gmail';

const { nodes, executors } = combinePacks([BUILTIN_PACK, GMAIL]);
```

OAuth credentials are passed per-node via a `secret` config field. Executors currently ship as stubs that log + forward; replace with real Gmail API calls by passing a custom pack that overrides each operation.
