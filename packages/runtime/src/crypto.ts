/**
 * HMAC signature verification for inbound webhooks. Uses Web Crypto
 * (available in Node 18+ and browsers) so there's no dependency. Constant-
 * time comparison guards against timing oracles.
 */

export type SignaturePreset = 'github' | 'stripe' | 'slack' | 'generic';

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.byteLength; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}

export async function hmacHex(secret: string, payload: string, algorithm: 'sha256' | 'sha1' = 'sha256'): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: algorithm === 'sha1' ? 'SHA-1' : 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return bytesToHex(new Uint8Array(sig));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify an inbound webhook signature against the raw request body.
 *
 * @param preset    provider scheme (github/stripe/slack/generic)
 * @param secret    the shared signing secret
 * @param rawBody   the exact bytes the signature was computed over
 * @param headers   request headers (case-insensitive lookup)
 * @param genericHeader header name to read for the `generic` preset
 */
export async function verifyWebhookSignature(
  preset: SignaturePreset,
  secret: string,
  rawBody: string,
  headers: Record<string, string>,
  genericHeader = 'x-signature',
): Promise<VerifyResult> {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v);

  try {
    if (preset === 'github') {
      const provided = h['x-hub-signature-256'];
      if (!provided) return { ok: false, reason: 'missing x-hub-signature-256 header' };
      const expected = `sha256=${await hmacHex(secret, rawBody, 'sha256')}`;
      return safeEqual(expected, provided) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
    }
    if (preset === 'stripe') {
      const provided = h['stripe-signature'];
      if (!provided) return { ok: false, reason: 'missing stripe-signature header' };
      const parts = Object.fromEntries(
        provided.split(',').map((kv) => kv.split('=') as [string, string]).filter((kv) => kv.length === 2),
      );
      if (!parts.t || !parts.v1) return { ok: false, reason: 'malformed stripe-signature' };
      const expected = await hmacHex(secret, `${parts.t}.${rawBody}`, 'sha256');
      return safeEqual(expected, parts.v1) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
    }
    if (preset === 'slack') {
      const provided = h['x-slack-signature'];
      const ts = h['x-slack-request-timestamp'];
      if (!provided) return { ok: false, reason: 'missing x-slack-signature header' };
      if (!ts) return { ok: false, reason: 'missing x-slack-request-timestamp header' };
      const expected = `v0=${await hmacHex(secret, `v0:${ts}:${rawBody}`, 'sha256')}`;
      return safeEqual(expected, provided) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
    }
    // generic
    const provided = h[genericHeader.toLowerCase()];
    if (!provided) return { ok: false, reason: `missing ${genericHeader} header` };
    const expected = await hmacHex(secret, rawBody, 'sha256');
    // Tolerate an optional `sha256=` prefix on generic too.
    const normalized = provided.startsWith('sha256=') ? provided.slice(7) : provided;
    return safeEqual(expected, normalized) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
