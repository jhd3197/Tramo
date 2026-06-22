/**
 * @tramo/box — official Box (file storage) integration pack.
 * Ships a brand webhook trigger (File Event) plus upload/get/download/delete/list/share/move
 * operation nodes with stub executors. Auth model: per-node OAuth 2.0 access token (secret field).
 */

import {
  defineNodePack,
  defineStubExecutor,
  httpJson,
  toEnvelope,
  requireFields,
  renderTemplate,
  type ExecutionContext,
  type NodeExecutionResult,
  type NodeExecutor,
} from '@tramo/runtime';
import type { IntegrationDefinition, NodeDefinition } from '@tramo/spec';

const COLOR = '#0061d5';
const API = 'https://api.box.com/2.0';
const UPLOAD_API = 'https://upload.box.com/api/2.0';

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

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const tokenOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.oauthToken ? String(ctx.config.oauthToken) : (typeof process !== 'undefined' ? process.env?.BOX_TOKEN : undefined);

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const noToken = { error: { message: 'box: OAuth token required (config.oauthToken or BOX_TOKEN)' } } as const;

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(clean, 'base64'));
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64(bytes: ArrayBuffer): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'box-upload-file': async (ctx) => {
    const miss = requireFields(ctx.config, ['parentFolderId', 'name'], 'box-upload-file');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const name = tpl(ctx, 'name');
    const contentB64 = tpl(ctx, 'contentBase64');
    let bytes: Uint8Array;
    try {
      bytes = b64ToBytes(contentB64);
    } catch {
      return { error: { message: 'box-upload-file: contentBase64 is not valid base64' } };
    }
    const form = new FormData();
    form.append(
      'attributes',
      JSON.stringify({ name, parent: { id: String(ctx.config.parentFolderId) } }),
    );
    form.append('file', new Blob([bytes]), name);
    const res = await fetch(`${UPLOAD_API}/files/content`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      body: form,
      signal: ctx.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (data && typeof data === 'object' && 'message' in data ? String((data as { message: unknown }).message) : '') || `HTTP ${res.status}`;
      return { error: { message: msg, status: res.status, data } };
    }
    const entry = (data && typeof data === 'object' && 'entries' in data && Array.isArray((data as { entries: unknown[] }).entries))
      ? (data as { entries: unknown[] }).entries[0]
      : data;
    return { out: entry };
  },

  'box-get-file': async (ctx) => {
    const miss = requireFields(ctx.config, ['fileId'], 'box-get-file');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const res = await httpJson({
      method: 'GET',
      url: `${API}/files/${String(ctx.config.fileId)}`,
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (res.status === 404) return { notFound: { fileId: String(ctx.config.fileId) } };
    return toEnvelope(res);
  },

  'box-download-file': async (ctx) => {
    const miss = requireFields(ctx.config, ['fileId'], 'box-download-file');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const res = await fetch(`${API}/files/${String(ctx.config.fileId)}/content`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      redirect: 'follow',
      signal: ctx.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: { message: `box-download-file: HTTP ${res.status}`, status: res.status, data: text } };
    }
    const buf = await res.arrayBuffer();
    return {
      out: {
        fileId: String(ctx.config.fileId),
        size: buf.byteLength,
        mimeType: res.headers.get('content-type') ?? 'application/octet-stream',
        contentBase64: bytesToB64(buf),
      },
    };
  },

  'box-delete-file': async (ctx) => {
    const miss = requireFields(ctx.config, ['fileId'], 'box-delete-file');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const res = await httpJson({
      method: 'DELETE',
      url: `${API}/files/${String(ctx.config.fileId)}`,
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return res.ok ? { out: { deleted: true, fileId: String(ctx.config.fileId) } } : toEnvelope(res);
  },

  'box-list-folder': async (ctx) => {
    const miss = requireFields(ctx.config, ['folderId'], 'box-list-folder');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const res = await httpJson<{ entries?: unknown[] }>({
      method: 'GET',
      url: `${API}/folders/${String(ctx.config.folderId)}/items`,
      query: {
        limit: ctx.config.limit != null ? Number(ctx.config.limit) : undefined,
        offset: ctx.config.offset != null ? Number(ctx.config.offset) : undefined,
      },
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!res.ok) return toEnvelope(res);
    return { out: res.data?.entries ?? [] };
  },

  'box-share': async (ctx) => {
    const miss = requireFields(ctx.config, ['itemId', 'itemType'], 'box-share');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const itemType = String(ctx.config.itemType) === 'folder' ? 'folders' : 'files';
    const res = await httpJson({
      method: 'PUT',
      url: `${API}/${itemType}/${String(ctx.config.itemId)}`,
      query: { fields: 'shared_link' },
      bearer: token,
      json: { shared_link: { access: String(ctx.config.access ?? 'open') } },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'box-move-file': async (ctx) => {
    const miss = requireFields(ctx.config, ['fileId', 'newParentFolderId'], 'box-move-file');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const body: Record<string, unknown> = { parent: { id: String(ctx.config.newParentFolderId) } };
    if (ctx.config.newName) body.name = tpl(ctx, 'newName');
    const res = await httpJson({
      method: 'PUT',
      url: `${API}/files/${String(ctx.config.fileId)}`,
      bearer: token,
      json: body,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  // Triggers (and anything without a real impl) keep the passthrough stub.
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'box',
  name: 'Box',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
