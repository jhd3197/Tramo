# @tramo/discord

Discord integration pack for [tramo](https://github.com/jhd3197/tramo). Webhook-based ops + bot-API ops + interaction trigger (7 ops + 1 trigger).

```ts
import { combinePacks, BUILTIN_PACK } from 'tramo-runtime';
import DISCORD from '@tramo/discord';

const { nodes, executors } = combinePacks([BUILTIN_PACK, DISCORD]);
```
