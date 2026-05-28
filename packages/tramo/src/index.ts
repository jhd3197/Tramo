/**
 * `tramo` umbrella — default import surface.
 *
 * The most common embedder shape is `import { Canvas, useWorkflow } from 'tramo'`,
 * so the package root re-exports the editor's React surface. Server-only
 * and per-brand consumers can reach the lower layers via subpath exports:
 *
 *   - `tramo/spec`     → tramo-spec
 *   - `tramo/runtime`  → tramo-runtime
 *   - `tramo/agent`    → @tramo/editor/agent
 *   - `tramo/styles.css`
 *   - `tramo/integrations/<brand>`
 */

export * from '@tramo/editor/react';
