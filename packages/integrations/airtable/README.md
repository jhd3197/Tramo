# @tramo/airtable

Airtable integration pack for [tramo](https://github.com/jhd3197/tramo). Create / update / get / delete / list / find records — 6 ops + 1 webhook trigger.

```ts
import { combinePacks, BUILTIN_PACK } from '@tramo/runtime';
import AIRTABLE from '@tramo/airtable';

const { nodes, executors } = combinePacks([BUILTIN_PACK, AIRTABLE]);
```
