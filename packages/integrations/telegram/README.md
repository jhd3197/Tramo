# @tramo/telegram

Telegram bot-API integration pack for [tramo](https://github.com/jhd3197/tramo). 6 operations (send message / photo / document, edit, delete, poll) + 1 webhook trigger.

```ts
import { combinePacks, BUILTIN_PACK } from '@tramo/runtime';
import TELEGRAM from '@tramo/telegram';

const { nodes, executors } = combinePacks([BUILTIN_PACK, TELEGRAM]);
```
