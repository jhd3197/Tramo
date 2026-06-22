# @tramo/stripe

Stripe integration pack for [tramo](https://github.com/jhd3197/tramo). Customers, payment intents, subscriptions, refunds, invoices, checkout sessions — 6 ops + 1 webhook trigger.

```ts
import { combinePacks, BUILTIN_PACK } from '@tramo/runtime';
import STRIPE from '@tramo/stripe';

const { nodes, executors } = combinePacks([BUILTIN_PACK, STRIPE]);
```
