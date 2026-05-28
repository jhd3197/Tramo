# @tramo/openai

OpenAI integration pack for [tramo](https://github.com/jhd3197/tramo). Chat, image, embed, transcribe, speech, moderation — 6 ops covering what the generic `ai-prompt` node doesn't.

```ts
import { combinePacks, BUILTIN_PACK } from 'tramo-runtime';
import OPENAI from '@tramo/openai';

const { nodes, executors } = combinePacks([BUILTIN_PACK, OPENAI]);
```
