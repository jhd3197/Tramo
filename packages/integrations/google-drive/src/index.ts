/**
 * @tramo/google-drive — official Google Drive integration pack.
 *
 * Covers upload, list, metadata, download, share, copy, delete, and folder
 * creation. Every operation expects an OAuth 2.0 access token (Drive scope).
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

const COLOR = '#1da462';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

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

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const tokenOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.oauthToken
    ? String(ctx.config.oauthToken)
    : (typeof process !== 'undefined' ? process.env?.GOOGLE_OAUTH_TOKEN : undefined);

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const missingToken = (id: string) => ({
  error: { message: `${id}: OAuth token required (config.oauthToken or GOOGLE_OAUTH_TOKEN)` },
});

/** Decode a base64 string to bytes in a way that works in Node and the browser. */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s/g, '');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(clean, 'base64'));
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Encode bytes to a base64 string in a way that works in Node and the browser. */
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'google-drive-upload': async (ctx) => {
    const miss = requireFields(ctx.config, ['name', 'mimeType'], 'google-drive-upload');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-drive-upload');

    const name = tpl(ctx, 'name');
    const mimeType = String(ctx.config.mimeType ?? 'application/octet-stream');
    const parent = String(ctx.config.parentFolderId ?? '').trim();
    const metadata: Record<string, unknown> = { name, mimeType };
    if (parent && parent !== 'root') metadata.parents = [parent];
    else if (parent === 'root') metadata.parents = ['root'];

    const contentB64 = tpl(ctx, 'contentBase64');
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(contentB64);
    } catch {
      return { error: { message: 'google-drive-upload: content must be valid base64' } };
    }

    const boundary = `tramo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const encoder = new TextEncoder();
    const preamble = encoder.encode(
      `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`,
    );
    const epilogue = encoder.encode(`\r\n--${boundary}--`);
    const b64Body = encoder.encode(bytesToBase64(bytes));
    const bodyBytes = new Uint8Array(preamble.length + b64Body.length + epilogue.length);
    bodyBytes.set(preamble, 0);
    bodyBytes.set(b64Body, preamble.length);
    bodyBytes.set(epilogue, preamble.length + b64Body.length);

    const res = await httpJson({
      method: 'POST',
      url: UPLOAD_API,
      query: { uploadType: 'multipart', supportsAllDrives: true, fields: 'id,name,mimeType,parents,size,webViewLink' },
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/related; boundary=${boundary}`,
      },
      body: new TextDecoder('latin1').decode(bodyBytes),
      signal: ctx.signal,
      timeoutMs: 60000,
    });
    return toEnvelope(res);
  },

  'google-drive-list': async (ctx) => {
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-drive-list');
    const folderId = String(ctx.config.folderId ?? 'root').trim() || 'root';
    const extra = String(ctx.config.query ?? '').trim();
    const q = `'${folderId}' in parents and trashed = false${extra ? ` and ${extra}` : ''}`;
    const res = await httpJson<{ files?: unknown[] }>({
      method: 'GET',
      url: `${API}/files`,
      query: {
        q,
        pageSize: ctx.config.pageSize != null ? Number(ctx.config.pageSize) : 50,
        fields: 'files(id,name,mimeType,parents,size,modifiedTime,webViewLink),nextPageToken',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      },
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return toEnvelope(res, (d) => (d?.files ?? []));
  },

  'google-drive-get-metadata': async (ctx) => {
    const miss = requireFields(ctx.config, ['fileId'], 'google-drive-get-metadata');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-drive-get-metadata');
    const res = await httpJson({
      method: 'GET',
      url: `${API}/files/${encodeURIComponent(String(ctx.config.fileId))}`,
      query: {
        fields: 'id,name,mimeType,parents,size,modifiedTime,createdTime,owners,webViewLink,md5Checksum',
        supportsAllDrives: true,
      },
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    if (res.status === 404) return { notFound: { fileId: String(ctx.config.fileId), status: 404 } };
    return toEnvelope(res);
  },

  'google-drive-download': async (ctx) => {
    const miss = requireFields(ctx.config, ['fileId'], 'google-drive-download');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-drive-download');
    const fileId = String(ctx.config.fileId);
    const exportMime = String(ctx.config.exportMimeType ?? '').trim();

    const url = exportMime
      ? `${API}/files/${encodeURIComponent(fileId)}/export`
      : `${API}/files/${encodeURIComponent(fileId)}`;
    const query: Record<string, string | boolean | undefined> = exportMime
      ? { mimeType: exportMime }
      : { alt: 'media', supportsAllDrives: true };

    const built = buildQuery(url, query);
    const signals: AbortSignal[] = [];
    if (ctx.signal) signals.push(ctx.signal);
    signals.push(AbortSignal.timeout(60000));
    let res: Response;
    try {
      res = await fetch(built, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
      });
    } catch (e) {
      return { error: { message: `google-drive-download: ${(e as Error).message}` } };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let data: unknown = text;
      try { data = JSON.parse(text); } catch { /* keep text */ }
      return { error: { message: `HTTP ${res.status}`, status: res.status, data } };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      out: {
        fileId,
        mimeType: res.headers.get('content-type') ?? undefined,
        size: buf.length,
        contentBase64: bytesToBase64(buf),
      },
    };
  },

  'google-drive-share': async (ctx) => {
    const miss = requireFields(ctx.config, ['fileId'], 'google-drive-share');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-drive-share');
    const type = String(ctx.config.type ?? 'anyone');
    const email = String(ctx.config.emailAddress ?? '').trim();
    if (type === 'user' && !email) {
      return { error: { message: 'google-drive-share: emailAddress is required when type = user' } };
    }
    const res = await httpJson({
      method: 'POST',
      url: `${API}/files/${encodeURIComponent(String(ctx.config.fileId))}/permissions`,
      query: { supportsAllDrives: true, fields: 'id,type,role,emailAddress' },
      bearer: token,
      json: {
        role: String(ctx.config.role ?? 'reader'),
        type,
        ...(type === 'user' && email ? { emailAddress: email } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return toEnvelope(res);
  },

  'google-drive-copy': async (ctx) => {
    const miss = requireFields(ctx.config, ['fileId'], 'google-drive-copy');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-drive-copy');
    const newName = tpl(ctx, 'newName').trim();
    const parent = String(ctx.config.parentFolderId ?? '').trim();
    const res = await httpJson({
      method: 'POST',
      url: `${API}/files/${encodeURIComponent(String(ctx.config.fileId))}/copy`,
      query: { supportsAllDrives: true, fields: 'id,name,mimeType,parents,webViewLink' },
      bearer: token,
      json: {
        ...(newName ? { name: newName } : {}),
        ...(parent ? { parents: [parent] } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return toEnvelope(res);
  },

  'google-drive-delete': async (ctx) => {
    const miss = requireFields(ctx.config, ['fileId'], 'google-drive-delete');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-drive-delete');
    const fileId = String(ctx.config.fileId);
    const res = await httpJson({
      method: 'DELETE',
      url: `${API}/files/${encodeURIComponent(fileId)}`,
      query: { supportsAllDrives: true },
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return res.ok ? { out: { deleted: true, fileId } } : toEnvelope(res);
  },

  'google-drive-create-folder': async (ctx) => {
    const miss = requireFields(ctx.config, ['name'], 'google-drive-create-folder');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-drive-create-folder');
    const parent = String(ctx.config.parentFolderId ?? 'root').trim();
    const res = await httpJson({
      method: 'POST',
      url: `${API}/files`,
      query: { supportsAllDrives: true, fields: 'id,name,mimeType,parents,webViewLink' },
      bearer: token,
      json: {
        name: tpl(ctx, 'name'),
        mimeType: 'application/vnd.google-apps.folder',
        ...(parent ? { parents: [parent] } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return toEnvelope(res);
  },
};

/** Append query params to a URL (mirrors the http helper, for the raw-fetch download path). */
function buildQuery(url: string, query: Record<string, string | boolean | undefined>): string {
  const entries = Object.entries(query).filter(([, v]) => v != null);
  if (entries.length === 0) return url;
  const sep = url.includes('?') ? '&' : '?';
  const qs = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${url}${sep}${qs}`;
}

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'google-drive',
  name: 'Google Drive',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
