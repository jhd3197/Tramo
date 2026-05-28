# @tramo/github

GitHub integration pack for [tramo](https://github.com/jhd3197/tramo). Adds 11 GitHub operations + 3 webhook triggers — issues, PRs, releases, repo stars, file fetch, workflow dispatch — to a tramo workflow editor / runtime.

```ts
import { combinePacks, BUILTIN_PACK } from 'tramo-runtime';
import GITHUB from '@tramo/github';

const { nodes, executors } = combinePacks([BUILTIN_PACK, GITHUB]);
```

Auth is per-node via a `secret` `token` field. Executors are stubs — wrap in a custom pack that omits the originals to substitute real GitHub API calls.
