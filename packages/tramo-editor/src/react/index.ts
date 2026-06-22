export {
  useWorkflow,
  type WorkflowHandle,
  type UseWorkflowOptions,
  type SaveState,
  type SaveStatus,
} from './useWorkflow.js';
export { Canvas, type CanvasProps } from './Canvas.js';
export { NodeView, type NodeViewProps, type NodeRunStatus } from './NodeView.js';
export { Edge, type EdgeProps } from './Edge.js';
export { PlusButton, type PlusButtonProps } from './PlusButton.js';
export { NodeIcon, type NodeIconProps } from './icons.js';
export { renderTitleWithVars } from './renderTitle.js';
export { NodeMenu, type NodeMenuProps } from './NodeMenu.js';
export {
  layoutWorkflow,
  type LayoutOptions,
  type LayoutResult,
  type NodeLayout,
} from './layout.js';
export { NodeInspector, type NodeInspectorProps, type FlowRef } from './NodeInspector.js';
export { SwitchCasesField, type SwitchCasesFieldProps } from './SwitchCasesField.js';
export { FlowParamsField, type FlowParamsFieldProps } from './FlowParamsField.js';
export { RightRail, type RightRailProps, type RightRailTab } from './RightRail.js';
export { AgentChat, type AgentChatProps } from './AgentChat.js';
export {
  getVarSuggestions,
  type VarSuggestion,
  type VarSuggestionsOptions,
} from './varSuggestions.js';
export { VarPicker, type VarPickerProps } from './VarPicker.js';
export { invertPatch } from './invertPatch.js';

/* --- canvas export (PNG/SVG) --- */
export {
  workflowToSvg,
  downloadWorkflowSvg,
  downloadWorkflowPng,
  type SvgExportOptions,
} from './exportSvg.js';
export { CanvasExportButton, type CanvasExportButtonProps } from './CanvasExportButton.js';

/* --- workflow diff --- */
export {
  diffWorkflows,
  summarizeDiff,
  type WorkflowDiff,
  type NodeChange,
  type EdgeChange,
  type FieldChange,
} from './diff.js';
export { DiffView, type DiffViewProps } from './DiffView.js';

/* --- variable references / go-to-definition --- */
export {
  extractReferences,
  buildReferenceIndex,
  findReferences,
  resolveReferenceTarget,
  type VarReference,
} from './references.js';

/* --- live run visualization --- */
export {
  deriveRunState,
  isEdgeActive,
  type DerivedRunState,
  type RunEventLike,
} from './runStatus.js';

/* --- node grouping / sub-graphs --- */
export {
  listGroups,
  groupForNode,
  createGroup,
  removeGroup,
  renameGroup,
  setGroupCollapsed,
  toggleGroup,
  setNodeGroup,
  hiddenNodeIds,
} from './groups.js';

/* --- dashboard + usage panels --- */
export { Dashboard, type DashboardProps, type DashboardRun, type DashboardStats } from './Dashboard.js';
export { UsagePanel, type UsagePanelProps, type UsageLike } from './UsagePanel.js';
