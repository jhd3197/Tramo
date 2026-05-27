/**
 * RightRail — tabbed sidebar with the NodeInspector by default. Matches
 * htmlstudio's RightRail surface so consumers can drop it in next to a
 * Canvas and get an editor in one composition.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { NodeInspector, type NodeInspectorProps } from './NodeInspector.js';

export interface RightRailTab {
  id: string;
  label: string;
  icon?: ReactNode;
  render: () => ReactNode;
}

export interface RightRailProps extends NodeInspectorProps {
  /** Additional tabs to append after the built-in Inspector. */
  tabs?: RightRailTab[];
}

export function RightRail({
  selection,
  registry,
  onApply,
  onClose,
  saveState,
  tabs = [],
}: RightRailProps) {
  const allTabs: RightRailTab[] = [
    {
      id: 'inspector',
      label: 'Inspector',
      render: () => (
        <NodeInspector
          selection={selection}
          registry={registry}
          onApply={onApply}
          onClose={onClose}
          saveState={saveState}
        />
      ),
    },
    ...tabs,
  ];

  const [active, setActive] = useState<string>(allTabs[0]?.id ?? 'inspector');

  useEffect(() => {
    if (selection) setActive('inspector');
  }, [selection?.id]);

  const current = allTabs.find((t) => t.id === active) ?? allTabs[0];

  return (
    <aside className="tr-rail">
      <div className="tr-rail__tabs">
        {allTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`tr-tab${t.id === active ? ' tr-tab--active' : ''}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div className="tr-rail__body">{current?.render()}</div>
    </aside>
  );
}

export default RightRail;
