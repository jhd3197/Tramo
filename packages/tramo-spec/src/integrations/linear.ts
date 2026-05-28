/**
 * Linear integration pack.
 *
 * Sibling to the github pack for engineering workflows — issues here are
 * Linear's first-class tickets, not GitHub issues.
 */

import type { IntegrationDefinition, NodeDefinition } from '../types.js';

const COLOR = '#5e6ad2';

export const DEFINITION: IntegrationDefinition = {
  id: 'linear',
  name: 'Linear',
  description: 'Tickets, comments, projects, search.',
  iconBrand: 'linear',
  color: COLOR,
  category: 'Developer',
};

export const NODES: NodeDefinition[] = [
  {
    id: 'linear-issue-create',
    integrationId: 'linear',
    name: 'Linear · Create Issue',
    operationName: 'Create issue',
    category: 'action',
    description: 'Open a new issue (ticket) in a Linear team.',
    icon: 'Cable',
    iconBrand: 'linear',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Issue', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'teamId', type: 'text', label: 'Team ID', default: '' },
      { key: 'title', type: 'text', label: 'Title (supports {{var}})', default: 'New issue from tramo' },
      { key: 'description', type: 'textarea', label: 'Description', default: '', optional: true },
      { key: 'priority', type: 'number', label: 'Priority (0 none, 1 urgent, 4 low)', default: 0, optional: true },
      { key: 'assigneeId', type: 'text', label: 'Assignee user ID', default: '', optional: true },
      { key: 'projectId', type: 'text', label: 'Project ID', default: '', optional: true },
    ],
  },
  {
    id: 'linear-issue-comment',
    integrationId: 'linear',
    name: 'Linear · Comment on Issue',
    operationName: 'Comment on issue',
    category: 'action',
    description: 'Post a comment on an existing Linear issue.',
    icon: 'Cable',
    iconBrand: 'linear',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Comment', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'issueId', type: 'text', label: 'Issue ID', default: '' },
      { key: 'body', type: 'textarea', label: 'Comment (supports {{var}})', default: '' },
    ],
  },
  {
    id: 'linear-issue-update',
    integrationId: 'linear',
    name: 'Linear · Update Issue',
    operationName: 'Update issue',
    category: 'action',
    description: 'Change the status, assignee, or labels of an existing issue.',
    icon: 'Cable',
    iconBrand: 'linear',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Issue', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'issueId', type: 'text', label: 'Issue ID', default: '' },
      { key: 'stateId', type: 'text', label: 'State ID (optional)', default: '', optional: true },
      { key: 'assigneeId', type: 'text', label: 'Assignee user ID (optional)', default: '', optional: true },
      { key: 'labelIds', type: 'json', label: 'Label IDs (JSON array)', default: '[]', optional: true },
      { key: 'priority', type: 'number', label: 'Priority (optional)', default: 0, optional: true },
    ],
  },
  {
    id: 'linear-issue-search',
    integrationId: 'linear',
    name: 'Linear · Search Issues',
    operationName: 'Search issues',
    category: 'action',
    description: 'Search issues by text query or by team/state filters.',
    icon: 'Cable',
    iconBrand: 'linear',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Issues', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'query', type: 'text', label: 'Text query (supports {{var}})', default: '', optional: true },
      { key: 'teamId', type: 'text', label: 'Team ID filter', default: '', optional: true },
      { key: 'stateName', type: 'text', label: 'State name filter (e.g. "In Progress")', default: '', optional: true },
      { key: 'limit', type: 'number', label: 'Max results', default: 25, optional: true },
    ],
  },
  {
    id: 'linear-project-create',
    integrationId: 'linear',
    name: 'Linear · Create Project',
    operationName: 'Create project',
    category: 'action',
    description: 'Create a project under one or more teams.',
    icon: 'Cable',
    iconBrand: 'linear',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Project', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'teamIds', type: 'json', label: 'Team IDs (JSON array)', default: '[]' },
      { key: 'name', type: 'text', label: 'Project name', default: 'Project from tramo' },
      { key: 'description', type: 'textarea', label: 'Description', default: '', optional: true },
      { key: 'targetDate', type: 'text', label: 'Target date (YYYY-MM-DD)', default: '', optional: true },
    ],
  },
  {
    id: 'linear-comment-list',
    integrationId: 'linear',
    name: 'Linear · List Comments',
    operationName: 'List comments',
    category: 'action',
    description: 'List comments on an issue, ordered most recent first.',
    icon: 'Cable',
    iconBrand: 'linear',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Comments', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'issueId', type: 'text', label: 'Issue ID', default: '' },
      { key: 'limit', type: 'number', label: 'Max comments', default: 50, optional: true },
    ],
  },
];
