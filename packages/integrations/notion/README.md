# @tramo/notion

Notion integration pack for [tramo](https://github.com/jhd3197/tramo). Pages, database rows, blocks, search — 6 ops.

```ts
import { combinePacks, BUILTIN_PACK } from 'tramo-runtime';
import NOTION from '@tramo/notion';

const { nodes, executors } = combinePacks([BUILTIN_PACK, NOTION]);
```
