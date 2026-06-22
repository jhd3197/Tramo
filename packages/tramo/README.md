# tramo

Umbrella meta-package for [tramo](https://github.com/jhd3197/tramo). Install this and you get the editor, the spec, the reference runtime, and every first-party brand integration pack from a single `npm install tramo`.

```bash
npm install tramo react react-dom
```

```ts
import { Canvas, RightRail, useWorkflow } from 'tramo';
import { emptyDoc, BUILTIN_REGISTRY } from 'tramo/spec';
import { run, BUILTIN_PACK, combinePacks } from 'tramo/runtime';
import GMAIL from 'tramo/integrations/gmail';
import GITHUB from 'tramo/integrations/github';
import 'tramo/styles.css';
```

This is a thin re-export layer over the lower-level packages — server-only or fine-grained consumers can depend on `@tramo/editor`, `@tramo/runtime`, `@tramo/spec`, and individual `@tramo/<brand>` packs directly to keep bundles tight. See the top-level [README](https://github.com/jhd3197/tramo) for the full embedding pitch.
