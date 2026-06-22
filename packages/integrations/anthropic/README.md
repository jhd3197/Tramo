# @tramo/anthropic

Anthropic / Claude integration pack for [tramo](https://github.com/jhd3197/tramo). Send messages, analyze images, extract structured data, summarize, classify, tool-use — 6 ops.

```ts
import { combinePacks, BUILTIN_PACK } from '@tramo/runtime';
import ANTHROPIC from '@tramo/anthropic';

const { nodes, executors } = combinePacks([BUILTIN_PACK, ANTHROPIC]);
```
