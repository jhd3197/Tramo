/**
 * NodesPanel — the palette. Lists registered nodes grouped by category;
 * each card is draggable onto the canvas and also clickable to insert
 * at the canvas center via the `onInsert` callback.
 *
 * Drag payload: a JSON string `{ tramoNodeType: "<id>" }` on the
 * `application/tramo+node` MIME type. The drop handler (in the host
 * app's canvas wrapper or `useTramoDnD` helper) decodes it.
 */

import type { NodeDefinition } from '../types.js';
import type { NodeRegistry } from '../nodes.js';

export const DRAG_MIME = 'application/tramo+node';

export interface NodesPanelProps {
  registry: NodeRegistry;
  onInsert?: (def: NodeDefinition) => void;
  /** Title shown at the top of the panel. Default "Nodes". */
  title?: string;
}

export function NodesPanel({ registry, onInsert, title = 'Nodes' }: NodesPanelProps) {
  const grouped = registry.byCategory();
  const categories = Object.keys(grouped).sort(categorySort);

  return (
    <aside className="tr-panel">
      <div className="tr-panel__head">{title}</div>
      <div className="tr-panel__body">
        {categories.map((cat) => (
          <section key={cat} className="tr-panel__group">
            <div className="tr-panel__group-head">{cat}</div>
            <div className="tr-panel__cards">
              {grouped[cat]!.map((def) => (
                <NodeCard key={def.id} def={def} onInsert={onInsert} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

function NodeCard({
  def,
  onInsert,
}: {
  def: NodeDefinition;
  onInsert?: (def: NodeDefinition) => void;
}) {
  return (
    <button
      type="button"
      className="tr-card"
      draggable
      style={{ borderLeftColor: def.color ?? '#94a3b8' }}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ tramoNodeType: def.id }));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onInsert?.(def)}
      title={def.description}
    >
      <div className="tr-card__head">
        <span className="tr-card__icon">{def.icon.charAt(0)}</span>
        <span className="tr-card__name">{def.name}</span>
      </div>
      <div className="tr-card__desc">{def.description}</div>
    </button>
  );
}

const CATEGORY_ORDER: Record<string, number> = {
  trigger: 0,
  action: 1,
  transform: 2,
  logic: 3,
  ai: 4,
  io: 5,
};

function categorySort(a: string, b: string): number {
  return (CATEGORY_ORDER[a] ?? 99) - (CATEGORY_ORDER[b] ?? 99);
}

export default NodesPanel;
