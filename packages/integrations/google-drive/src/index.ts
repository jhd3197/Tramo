/**
 * @tramo/google-drive — official Google Drive integration pack.
 *
 * Covers upload, list, metadata, download, share, copy, delete, and folder
 * creation. Every operation expects an OAuth 2.0 access token (Drive scope).
 */

import { defineNodePack, defineStubExecutor } from 'tramo-runtime';
import type { IntegrationDefinition, NodeDefinition } from 'tramo-spec';

const COLOR = '#1da462';

const DEFINITION: IntegrationDefinition = {
  id: 'google-drive',
  name: 'Google Drive',
  description: 'Upload, list, share, copy, delete Drive files.',
  iconBrand: 'googledrive',
  color: COLOR,
  category: 'Productivity',
};

const NODES: NodeDefinition[] = [
  {
    id: 'google-drive-upload',
    integrationId: 'google-drive',
    name: 'Google Drive · Upload File',
    operationName: 'Upload file',
    category: 'action',
    description: 'Upload a new file to a Drive folder.',
    icon: 'Cable',
    iconBrand: 'googledrive',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'File', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'parentFolderId', type: 'text', label: 'Parent folder ID', default: 'root' },
      { key: 'name', type: 'text', label: 'File name', default: 'untitled.txt' },
      { key: 'mimeType', type: 'text', label: 'MIME type', default: 'text/plain' },
      { key: 'contentBase64', type: 'textarea', label: 'Content (base64, supports {{var}})', default: '' },
    ],
  },
  {
    id: 'google-drive-list',
    integrationId: 'google-drive',
    name: 'Google Drive · List Files in Folder',
    operationName: 'List files in folder',
    category: 'action',
    description: 'List the files inside a Drive folder.',
    icon: 'Cable',
    iconBrand: 'googledrive',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Files', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'folderId', type: 'text', label: 'Folder ID', default: 'root' },
      { key: 'query', type: 'text', label: 'Extra query', default: '', optional: true, help: 'Appended to the q parameter (e.g. mimeType=\'application/pdf\').' },
      { key: 'pageSize', type: 'number', label: 'Page size', default: 50, optional: true },
    ],
  },
  {
    id: 'google-drive-get-metadata',
    integrationId: 'google-drive',
    name: 'Google Drive · Get File Metadata',
    operationName: 'Get file metadata',
    category: 'action',
    description: 'Fetch metadata (name, size, mimeType, parents, …) for a file.',
    icon: 'Cable',
    iconBrand: 'googledrive',
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
    id: 'google-drive-download',
    integrationId: 'google-drive',
    name: 'Google Drive · Download File',
    operationName: 'Download file',
    category: 'action',
    description: 'Download a file\'s content as base64.',
    icon: 'Cable',
    iconBrand: 'googledrive',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'File', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'fileId', type: 'text', label: 'File ID', default: '' },
      { key: 'exportMimeType', type: 'text', label: 'Export MIME type', default: '', optional: true, help: 'For Google-native docs (e.g. application/pdf).' },
    ],
  },
  {
    id: 'google-drive-share',
    integrationId: 'google-drive',
    name: 'Google Drive · Share File',
    operationName: 'Share file',
    category: 'action',
    description: 'Create a permission on a file (share with a user or make public).',
    icon: 'Cable',
    iconBrand: 'googledrive',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Permission', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'fileId', type: 'text', label: 'File ID', default: '' },
      {
        key: 'role',
        type: 'select',
        label: 'Role',
        default: 'reader',
        options: [
          { label: 'Reader', value: 'reader' },
          { label: 'Commenter', value: 'commenter' },
          { label: 'Writer', value: 'writer' },
        ],
      },
      {
        key: 'type',
        type: 'select',
        label: 'Type',
        default: 'anyone',
        options: [
          { label: 'User', value: 'user' },
          { label: 'Anyone', value: 'anyone' },
        ],
      },
      { key: 'emailAddress', type: 'text', label: 'Email address', default: '', optional: true, help: 'Required when type = user.' },
    ],
  },
  {
    id: 'google-drive-copy',
    integrationId: 'google-drive',
    name: 'Google Drive · Copy File',
    operationName: 'Copy file',
    category: 'action',
    description: 'Duplicate an existing file, optionally renaming or reparenting it.',
    icon: 'Cable',
    iconBrand: 'googledrive',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'File', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'fileId', type: 'text', label: 'File ID', default: '' },
      { key: 'newName', type: 'text', label: 'New name', default: '', optional: true },
      { key: 'parentFolderId', type: 'text', label: 'Parent folder ID', default: '', optional: true },
    ],
  },
  {
    id: 'google-drive-delete',
    integrationId: 'google-drive',
    name: 'Google Drive · Delete File',
    operationName: 'Delete file',
    category: 'action',
    description: 'Permanently delete a file from Drive.',
    icon: 'Cable',
    iconBrand: 'googledrive',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'fileId', type: 'text', label: 'File ID', default: '' },
    ],
  },
  {
    id: 'google-drive-create-folder',
    integrationId: 'google-drive',
    name: 'Google Drive · Create Folder',
    operationName: 'Create folder',
    category: 'action',
    description: 'Create a new folder under a parent folder.',
    icon: 'Cable',
    iconBrand: 'googledrive',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Folder', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'parentFolderId', type: 'text', label: 'Parent folder ID', default: 'root' },
      { key: 'name', type: 'text', label: 'Folder name', default: 'New folder' },
    ],
  },
];

export default defineNodePack({
  id: 'google-drive',
  name: 'Google Drive',
  version: '0.1.0',
  entries: NODES.map((definition) => ({
    definition,
    executor: defineStubExecutor(definition),
  })),
  integrations: [DEFINITION],
});
