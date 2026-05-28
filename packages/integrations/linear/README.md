# @tramo/linear

Linear integration pack for [tramo](https://github.com/jhd3197/tramo). Issues, comments, projects, search — 6 ops + 1 webhook trigger.

```ts
import { combinePacks, BUILTIN_PACK } from 'tramo-runtime';
import LINEAR from '@tramo/linear';

const { nodes, executors } = combinePacks([BUILTIN_PACK, LINEAR]);
```
