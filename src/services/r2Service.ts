import { fetch } from '@tauri-apps/plugin-http';
import type { R2AccountConfig, R2BucketConfig } from '../stores/settings';

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(data)));
}

async function hmacSign(key: BufferSource, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}

async function deriveSigningKey(secret: string, dateStamp: string): Promise<ArrayBuffer> {
  let key: BufferSource = enc.encode('AWS4' + secret);
  for (const part of [dateStamp, 'auto', 's3', 'aws4_request']) {
    key = await hmacSign(key, part);
  }
  return key as ArrayBuffer;
}

function encodeSegment(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function canonicalURI(path: string): string {
  return path.split('/').map(seg => (seg ? encodeSegment(seg) : '')).join('/');
}

function canonicalQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map(k => `${encodeSegment(k)}=${encodeSegment(params[k])}`)
    .join('&');
}

interface R2Context {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName?: string;
  jurisdiction?: 'eu';
}

function r2Host(ctx: R2Context): string {
  return ctx.jurisdiction
    ? `${ctx.accountId}.${ctx.jurisdiction}.r2.cloudflarestorage.com`
    : `${ctx.accountId}.r2.cloudflarestorage.com`;
}

function mergeContext(account: R2AccountConfig, bucket?: R2BucketConfig): R2Context {
  return {
    accountId: account.accountId,
    accessKeyId: account.accessKeyId,
    secretAccessKey: account.secretAccessKey,
    bucketName: bucket?.bucketName,
    jurisdiction: bucket?.jurisdiction,
  };
}

async function r2Fetch(
  ctx: R2Context,
  method: string,
  keyPath: string,
  queryParams: Record<string, string> = {},
  body = '',
  contentType?: string,
): Promise<Response> {
  const host = r2Host(ctx);
  const rawPath = ctx.bucketName
    ? (keyPath ? `/${ctx.bucketName}/${keyPath}` : `/${ctx.bucketName}`)
    : '/';

  const now = new Date();
  const iso = now.toISOString();
  const dateStamp = iso.slice(0, 10).replace(/-/g, '');
  const amzDate = dateStamp + 'T' + iso.slice(11, 19).replace(/:/g, '') + 'Z';

  const payloadHash = await sha256hex(body);
  const canonQuery = canonicalQueryString(queryParams);

  const signHeaders: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) signHeaders['content-type'] = contentType;

  const sortedNames = Object.keys(signHeaders).sort();
  const canonHeaders = sortedNames.map(h => `${h}:${signHeaders[h]}`).join('\n') + '\n';
  const signedHeaders = sortedNames.join(';');

  const canonRequest = [
    method,
    canonicalURI(rawPath),
    canonQuery,
    canonHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credScope = `${dateStamp}/auto/s3/aws4_request`;
  const strToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credScope,
    await sha256hex(canonRequest),
  ].join('\n');

  const sigKey = await deriveSigningKey(ctx.secretAccessKey, dateStamp);
  const sig = toHex(await hmacSign(sigKey, strToSign));
  const auth = `AWS4-HMAC-SHA256 Credential=${ctx.accessKeyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const encodedPath = canonicalURI(rawPath);
  const url = `https://${host}${encodedPath}${canonQuery ? '?' + canonQuery : ''}`;

  const fetchHeaders: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: auth,
  };
  if (contentType) fetchHeaders['content-type'] = contentType;

  return fetch(url, {
    method,
    headers: fetchHeaders,
    body: body || undefined,
  });
}

export interface R2ListResult {
  prefixes: string[];
  keys: string[];
}

export async function listBuckets(account: R2AccountConfig): Promise<string[]> {
  const ctx = mergeContext(account);
  const resp = await r2Fetch(ctx, 'GET', '', {});
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`R2 list buckets failed (${resp.status}): ${body}`);
  }
  const xml = await resp.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return [...doc.querySelectorAll('Bucket > Name')].map(el => el.textContent ?? '');
}

export async function listObjects(
  account: R2AccountConfig,
  bucket: R2BucketConfig,
  prefix = '',
  delimiter = '/',
): Promise<R2ListResult> {
  const ctx = mergeContext(account, bucket);
  const params: Record<string, string> = { 'list-type': '2', delimiter };
  if (prefix) params.prefix = prefix;

  const resp = await r2Fetch(ctx, 'GET', '', params);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`R2 list failed (${resp.status}): ${body}`);
  }

  const xml = await resp.text();
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const keys = [...doc.querySelectorAll('Contents > Key')].map(el => el.textContent ?? '');
  const prefixes = [...doc.querySelectorAll('CommonPrefixes > Prefix')].map(el => el.textContent ?? '');
  return { prefixes, keys };
}

export async function getObject(
  account: R2AccountConfig,
  bucket: R2BucketConfig,
  key: string,
): Promise<string> {
  const ctx = mergeContext(account, bucket);
  const resp = await r2Fetch(ctx, 'GET', key);
  if (!resp.ok) throw new Error(`R2 get failed (${resp.status})`);
  return resp.text();
}

export async function putObject(
  account: R2AccountConfig,
  bucket: R2BucketConfig,
  key: string,
  content: string,
): Promise<void> {
  const ctx = mergeContext(account, bucket);
  const resp = await r2Fetch(ctx, 'PUT', key, {}, content, 'text/plain; charset=utf-8');
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`R2 put failed (${resp.status}): ${body}`);
  }
}
