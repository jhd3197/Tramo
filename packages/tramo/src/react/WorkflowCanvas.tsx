/**
 * Drop-in XYFlow canvas wired up to a useWorkflow handle. Pass the
 * handle in; the canvas reads its derived nodes/edges and forwards
 * its event handlers. Selection is bidirectional — click on the
 * canvas updates the inspector; programmatic setSelection highlights
 * the right node.
 */

import { useMemo } from 'react';
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import type { ReactFlowProps } from '@xyflow/react';
import { TramoNode } from './TramoNode.js';
import type { WorkflowHandle } from './useWorkflow.js';

export interface WorkflowCanvasProps
  extends Omit<
    ReactFlowProps,
    | 'nodes'
    | 'edges'
    | 'onNodesChange'
    | 'onEdgesChange'
    | 'onConnect'
    | 'nodeTypes'
  > {
  workflow: WorkflowHandle;
  /** Show the bottom-right minimap. Default true. */
  showMinimap?: boolean;
  /** Show the bottom-left zoom/lock controls. Default true. */
  showControls?: boolean;
  /** Show the grid background. Default true. */
  showBackground?: boolean;
}

export function WorkflowCanvas({
  workflow,
  showMinimap = true,
  showControls = true,
  showBackground = true,
  ...rest
}: WorkflowCanvasProps) {
  const nodeTypes = useMemo(() => ({ tramo: TramoNode }), []);

  return (
    <div className="tr-canvas">
      <ReactFlow
        nodes={workflow.nodes}
        edges={workflow.edges}
        onNodesChange={workflow.onNodesChange}
        onEdgesChange={workflow.onEdgesChange}
        onConnect={workflow.onConnect}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        {...rest}
      >
        {showBackground ? <Background gap={20} size={1} /> : null}
        {showControls ? <Controls showInteractive={false} /> : null}
        {showMinimap ? <MiniMap pannable zoomable className="tr-minimap" /> : null}
      </ReactFlow>
    </div>
  );
}

export default WorkflowCanvas;
