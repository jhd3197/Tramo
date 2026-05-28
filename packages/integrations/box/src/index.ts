/**
 * @tramo/box — official Box (file storage) integration pack.
 * Ships a brand webhook trigger (File Event) plus upload/get/download/delete/list/share/move
 * operation nodes with stub executors. Auth model: per-node OAuth 2.0 access token (secret field).
 */

import { defineNodePack, defineStubExecutor } from 'tramo-runtime';
import type { IntegrationDefinition, NodeDefinition } from 'tramo-spec';

const COLOR = '#0061d5';

const DEFINITION: IntegrationDefinition = {
  id: 'box',
  name: 'Box',
  description: 'Upload, share, download, list, delete files.',
  iconBrand: 'box',
  color: COLOR,
  category: 'Productivity',
};

const NODES: NodeDefinition[] = [
  {
    id: 'webhook-trigger:box:file-event',
    integrationId: 'box',
    name: 'Box · On File Event',
    operationName: 'On file event',
    category: 'trigger',
    description: 'Fires when Box POSTs a file webhook (FILE.UPLOADED, FILE.DELETED, …).',
    icon: 'CloudDownload',
    iconBrand: 'box',
    color: COLOR,
    inputs: [],
    outputs: [{ key: 'out', label: 'Request', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/box/events', help: 'Configure as the address of a Box webhook on a folder.' },
      { key: 'method', type: 'select', label: 'Method', default: 'POST', options: [{ label: 'POST', value: 'POST' }] },
      { key: 'triggers', type: 'text', label: 'Filter trigger types (comma-separated, blank = all)', default: '', optional: true, help: 'Filter Box trigger types like FILE.UPLOADED,FILE.DELETED. Comma-separated.' },
      { key: 'primaryKey', type: 'secret', label: 'Primary signature key', optional: true, help: 'Box signs payloads with box-signature-primary/secondary. Validation downstream.' },
    ],
  },
  {
    id: 'box-upload-file',
    integrationId: 'box',
    name: 'Box · Upload File',
    operationName: 'Upload file',
    category: 'action',
    description: 'Upload a new file to a Box folder.',
    icon: 'Cable',
    iconBrand: 'box',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'File', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'parentFolderId', type: 'text', label: 'Parent folder ID', default: '0', help: '0 = root folder' },
      { key: 'name', type: 'text', label: 'File name (supports {{var}})', default: 'tramo-upload.txt' },
      { key: 'contentBase64', type: 'textarea', label: 'Content (base64, supports {{var}})', default: '', help: 'Base64-encoded file content. Use a binary fetch upstream.' },
    ],
  },
  {
    id: 'box-get-file',
    integrationId: 'box',
    name: 'Box · Get File Metadata',
    operationName: 'Get file metadata',
    category: 'action',
    description: 'Fetch metadata for a Box file by ID.',
    icon: 'Cable',
    iconBrand: 'box',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'File', type: 'object' },
      { key: 'notFound', label: 'Not found', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'fileId', type: 'text', label: 'File ID', default: '' },
    ],
  },
  {
    id: 'box-download-file',
    integrationId: 'box',
    name: 'Box · Download File',
    operationName: 'Download file',
    category: 'action',
    description: 'Download a file from Box as base64 content with size and mime type.',
    icon: 'Cable',
    iconBrand: 'box',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Content', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'fileId', type: 'text', label: 'File ID', default: '' },
    ],
  },
  {
    id: 'box-delete-file',
    integrationId: 'box',
    name: 'Box · Delete File',
    operationName: 'Delete file',
    category: 'action',
    description: 'Permanently delete a file in Box.',
    icon: 'Cable',
    iconBrand: 'box',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'fileId', type: 'text', label: 'File ID', default: '' },
    ],
  },
  {
    id: 'box-list-folder',
    integrationId: 'box',
    name: 'Box · List Folder',
    operationName: 'List folder',
    category: 'action',
    description: 'List items in a Box folder with pagination.',
    icon: 'Cable',
    iconBrand: 'box',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Items', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'folderId', type: 'text', label: 'Folder ID', default: '0' },
      { key: 'limit', type: 'number', label: 'Limit', default: 100, optional: true },
      { key: 'offset', type: 'number', label: 'Offset', default: 0, optional: true },
    ],
  },
  {
    id: 'box-share',
    integrationId: 'box',
    name: 'Box · Create Shared Link',
    operationName: 'Create shared link',
    category: 'action',
    description: 'Create a shared link for a Box file or folder.',
    icon: 'Cable',
    iconBrand: 'box',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'SharedLink', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'itemId', type: 'text', label: 'Item ID', default: '' },
      {
        key: 'itemType',
        type: 'select',
        label: 'Item type',
        default: 'file',
        options: [
          { label: 'File', value: 'file' },
          { label: 'Folder', value: 'folder' },
        ],
      },
      {
        key: 'access',
        type: 'select',
        label: 'Access',
        default: 'open',
        options: [
          { label: 'Open (anyone with link)', value: 'open' },
          { label: 'Company', value: 'company' },
          { label: 'Collaborators', value: 'collaborators' },
        ],
      },
    ],
  },
  {
    id: 'box-move-file',
    integrationId: 'box',
    name: 'Box · Move File',
    operationName: 'Move file',
    category: 'action',
    description: 'Move a file to a different Box folder (optionally rename).',
    icon: 'Cable',
    iconBrand: 'box',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'File', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'fileId', type: 'text', label: 'File ID', default: '' },
      { key: 'newParentFolderId', type: 'text', label: 'New parent folder ID', default: '0' },
      { key: 'newName', type: 'text', label: 'New name', default: '', optional: true },
    ],
  },
];

export default defineNodePack({
  id: 'box',
  name: 'Box',
  version: '0.1.0',
  entries: NODES.map((definition) => ({
    definition,
    executor: defineStubExecutor(definition),
  })),
  integrations: [DEFINITION],
});
