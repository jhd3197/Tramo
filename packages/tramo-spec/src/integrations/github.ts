/**
 * GitHub integration pack.
 *
 * Each entry below is a NodeDefinition tagged with `integrationId: 'github'`
 * so the picker groups them under one tile. Add a new operation by appending
 * to NODES and registering an executor with the same id in tramo-runtime.
 *
 * Shape is intentionally JSON-friendly: an LLM can be handed the GitHub REST
 * docs + the IntegrationDefinition/NodeDefinition types and emit new entries.
 */

import type { IntegrationDefinition, NodeDefinition } from '../types.js';

const COLOR = '#24292f';

export const DEFINITION: IntegrationDefinition = {
  id: 'github',
  name: 'GitHub',
  description: 'Issues, comments, pull requests, stars.',
  iconBrand: 'github',
  color: COLOR,
  category: 'Developer',
};

export const NODES: NodeDefinition[] = [
  {
    id: 'github-issue-create',
    integrationId: 'github',
    name: 'GitHub · Create Issue',
    operationName: 'Create issue',
    category: 'action',
    description: 'Open a new issue in a repository.',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Issue', type: 'object' }],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'title', type: 'text', label: 'Title (supports {{var}})', default: 'Triggered from tramo' },
      { key: 'body', type: 'textarea', label: 'Body', default: '', optional: true },
      { key: 'labels', type: 'text', label: 'Labels (comma-separated)', default: '', optional: true },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
  {
    id: 'github-issue-comment',
    integrationId: 'github',
    name: 'GitHub · Comment on Issue',
    operationName: 'Comment on issue',
    category: 'action',
    description: 'Post a comment on an existing issue or pull request.',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Comment', type: 'object' }],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'issueNumber', type: 'number', label: 'Issue or PR number', default: 1 },
      { key: 'body', type: 'textarea', label: 'Comment (supports {{var}})', default: '' },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
  {
    id: 'github-pr-create',
    integrationId: 'github',
    name: 'GitHub · Open Pull Request',
    operationName: 'Open pull request',
    category: 'action',
    description: 'Open a pull request between two branches.',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'PR', type: 'object' }],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'title', type: 'text', label: 'Title', default: 'New PR from tramo' },
      { key: 'head', type: 'text', label: 'Head branch', default: 'feature/x' },
      { key: 'base', type: 'text', label: 'Base branch', default: 'main' },
      { key: 'body', type: 'textarea', label: 'Body', default: '', optional: true },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
  {
    id: 'github-repo-star',
    integrationId: 'github',
    name: 'GitHub · Star Repo',
    operationName: 'Star repository',
    category: 'action',
    description: 'Star a repository with the authenticated user.',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
  {
    id: 'github-dispatch',
    integrationId: 'github',
    name: 'GitHub · Trigger Workflow',
    operationName: 'Dispatch workflow',
    category: 'action',
    description: 'Trigger a repository_dispatch event for GitHub Actions.',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'eventType', type: 'text', label: 'Event type', default: 'tramo-run' },
      { key: 'payload', type: 'json', label: 'Client payload (JSON)', default: '{}', optional: true },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
];
