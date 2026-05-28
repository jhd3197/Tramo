/**
 * @tramo/google-tasks — official Google Tasks integration pack.
 * Create, complete, list, and delete tasks via the Google Tasks API.
 * Auth: OAuth 2.0 access token supplied per-node as a secret field.
 */

import { defineNodePack, defineStubExecutor } from 'tramo-runtime';
import type { IntegrationDefinition, NodeDefinition } from 'tramo-spec';

const COLOR = '#4285f4';

const DEFINITION: IntegrationDefinition = {
  id: 'google-tasks',
  name: 'Google Tasks',
  description: 'Create, complete, list, and delete tasks.',
  iconBrand: 'googletasks',
  color: COLOR,
  category: 'Productivity',
};

const NODES: NodeDefinition[] = [
  {
    id: 'google-tasks-create',
    integrationId: 'google-tasks',
    name: 'Google Tasks · Create Task',
    operationName: 'Create task',
    category: 'action',
    description: 'Create a new task in the specified task list.',
    icon: 'Cable',
    iconBrand: 'googletasks',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Task', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'taskListId', type: 'text', label: 'Task list ID', default: '@default' },
      { key: 'title', type: 'text', label: 'Title (supports {{var}})', default: '' },
      { key: 'notes', type: 'textarea', label: 'Notes', default: '', optional: true },
      { key: 'due', type: 'text', label: 'Due', default: '', optional: true, help: 'RFC 3339 timestamp, e.g. 2026-06-01T00:00:00Z' },
    ],
  },
  {
    id: 'google-tasks-complete',
    integrationId: 'google-tasks',
    name: 'Google Tasks · Complete Task',
    operationName: 'Complete task',
    category: 'action',
    description: 'Mark an existing task as completed.',
    icon: 'Cable',
    iconBrand: 'googletasks',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Task', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'taskListId', type: 'text', label: 'Task list ID', default: '@default' },
      { key: 'taskId', type: 'text', label: 'Task ID', default: '' },
    ],
  },
  {
    id: 'google-tasks-list',
    integrationId: 'google-tasks',
    name: 'Google Tasks · List Tasks',
    operationName: 'List tasks',
    category: 'action',
    description: 'List tasks from the specified task list.',
    icon: 'Cable',
    iconBrand: 'googletasks',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Tasks', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'taskListId', type: 'text', label: 'Task list ID', default: '@default' },
      { key: 'showCompleted', type: 'boolean', label: 'Show completed', default: false, optional: true },
      { key: 'maxResults', type: 'number', label: 'Max results', default: 50, optional: true },
    ],
  },
  {
    id: 'google-tasks-delete',
    integrationId: 'google-tasks',
    name: 'Google Tasks · Delete Task',
    operationName: 'Delete task',
    category: 'action',
    description: 'Delete a task from the specified task list.',
    icon: 'Cable',
    iconBrand: 'googletasks',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'taskListId', type: 'text', label: 'Task list ID', default: '@default' },
      { key: 'taskId', type: 'text', label: 'Task ID', default: '' },
    ],
  },
  {
    id: 'google-tasks-list-tasklists',
    integrationId: 'google-tasks',
    name: 'Google Tasks · List Task Lists',
    operationName: 'List task lists',
    category: 'action',
    description: 'List all task lists for the authenticated user.',
    icon: 'Cable',
    iconBrand: 'googletasks',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Task Lists', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'maxResults', type: 'number', label: 'Max results', default: 20, optional: true },
    ],
  },
];

export default defineNodePack({
  id: 'google-tasks',
  name: 'Google Tasks',
  version: '0.1.0',
  entries: NODES.map((definition) => ({
    definition,
    executor: defineStubExecutor(definition),
  })),
  integrations: [DEFINITION],
});
