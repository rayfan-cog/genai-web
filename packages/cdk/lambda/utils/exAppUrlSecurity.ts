import { lookup } from 'node:dns/promises';
import * as https from 'node:https';
import ipaddr = require('ipaddr.js');

const MAX_ENDPOINT_URL_LENGTH = 4096;
const MAX_STATUS_URL_LENGTH = 2048;

export class UnsafeExAppUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeExAppUrlError';
  }
}

export type ValidatedExAppUrl = {
  readonly url: URL;
  readonly addresses: readonly ResolvedAddress[];
};

export type ResolvedAddress = {
  readonly address: string;
  readonly family: 4 | 6;
};

export type ExAppHttpRequestOptions = {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
};

export type ExAppHttpResponse = Pick<Response, 'ok' | 'status' | 'text' | 'json'>;

const normalizeIpLiteral = (hostname: string): string =>
  hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

const trimTrailingDots = (hostname: string): string => {
  let end = hostname.length;
  while (end > 0 && hostname.charCodeAt(end - 1) === 46) {
    end -= 1;
  }
  return hostname.slice(0, end);
};

const hasUnsafeRawCharacters = (value: string): boolean =>
  value.trim() !== value || hasControlCharacter(value);

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    if (charCode <= 0x1f || charCode === 0x7f) {
      return true;
    }
  }
  return false;
};

const normalizeHostname = (hostname: string): string =>
  trimTrailingDots(normalizeIpLiteral(hostname).toLowerCase());

const assertPublicAddress = (
  address: string,
  message = 'APIエンドポイントには公開 IP アドレスを指定してください。',
): void => {
  if (ipaddr.process(address).range() !== 'unicast') {
    throw new UnsafeExAppUrlError(message);
  }
};

const assertAllowedHostname = async (hostname: string): Promise<readonly ResolvedAddress[]> => {
  const normalizedHostname = normalizeHostname(hostname);
  if (normalizedHostname.length === 0) {
    throw new UnsafeExAppUrlError('APIエンドポイントのホスト名を指定してください。');
  }
  if (normalizedHostname === 'localhost' || normalizedHostname.endsWith('.localhost')) {
    throw new UnsafeExAppUrlError('APIエンドポイントのホスト名は許可されていません。');
  }
  if (ipaddr.isValid(normalizedHostname)) {
    assertPublicAddress(normalizedHostname);
    const family = ipaddr.parse(normalizedHostname).kind() === 'ipv4' ? 4 : 6;
    return [{ address: normalizedHostname, family }];
  }

  let addresses: readonly ResolvedAddress[];
  try {
    addresses = (await lookup(normalizedHostname, { all: true, verbatim: true })).map(
      ({ address, family }) => ({ address, family: family as 4 | 6 }),
    );
  } catch {
    throw new UnsafeExAppUrlError('APIエンドポイントのホスト名を解決できません。');
  }
  if (addresses.length === 0) {
    throw new UnsafeExAppUrlError('APIエンドポイントのホスト名を解決できません。');
  }
  for (const { address } of addresses) {
    assertPublicAddress(
      address,
      'APIエンドポイントには公開 IP アドレスに解決されるホスト名を指定してください。',
    );
  }
  return addresses;
};

export const parseHttpsUrl = (value: string): URL => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ENDPOINT_URL_LENGTH ||
    hasUnsafeRawCharacters(value)
  ) {
    throw new UnsafeExAppUrlError('APIエンドポイントの形式が不正です。');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnsafeExAppUrlError('APIエンドポイントの形式が不正です。');
  }

  if (url.protocol !== 'https:') {
    throw new UnsafeExAppUrlError('APIエンドポイントには HTTPS URL を指定してください。');
  }
  if (!url.hostname) {
    throw new UnsafeExAppUrlError('APIエンドポイントのホスト名を指定してください。');
  }
  if (url.username || url.password) {
    throw new UnsafeExAppUrlError('APIエンドポイントに認証情報は含められません。');
  }
  if (url.hash) {
    throw new UnsafeExAppUrlError('APIエンドポイントにフラグメントは含められません。');
  }

  return url;
};

export const assertPublicEndpointUrl = async (value: string): Promise<ValidatedExAppUrl> => {
  const url = parseHttpsUrl(value);
  const addresses = await assertAllowedHostname(url.hostname);
  return { url, addresses };
};

export const resolveRelativeStatusUrl = (
  statusUrl: string,
  endpoint: ValidatedExAppUrl,
): ValidatedExAppUrl => {
  if (
    typeof statusUrl !== 'string' ||
    statusUrl.length === 0 ||
    statusUrl.length > MAX_STATUS_URL_LENGTH ||
    hasUnsafeRawCharacters(statusUrl) ||
    !statusUrl.startsWith('/') ||
    statusUrl.startsWith('//') ||
    statusUrl.includes('\\')
  ) {
    throw new UnsafeExAppUrlError('ステータスURLには同一オリジンの相対パスを指定してください。');
  }

  const resolvedUrl = new URL(statusUrl, endpoint.url);
  if (resolvedUrl.origin !== endpoint.url.origin || resolvedUrl.protocol !== 'https:') {
    throw new UnsafeExAppUrlError(
      'ステータスURLはAPIエンドポイントと同一オリジンである必要があります。',
    );
  }
  if (resolvedUrl.hash) {
    throw new UnsafeExAppUrlError('ステータスURLにフラグメントは含められません。');
  }

  return { url: resolvedUrl, addresses: endpoint.addresses };
};

export const assertPublicStatusUrl = async (
  statusUrl: string,
  endpoint: string,
): Promise<ValidatedExAppUrl> => {
  const validatedEndpoint = await assertPublicEndpointUrl(endpoint);
  return resolveRelativeStatusUrl(statusUrl, validatedEndpoint);
};

export const toRelativeStatusUrl = (url: URL): string => `${url.pathname}${url.search}`;

export const isExAppUrlValidationError = (error: unknown): error is UnsafeExAppUrlError =>
  error instanceof UnsafeExAppUrlError;

export const requestValidatedExAppUrl = async (
  validatedUrl: ValidatedExAppUrl,
  options: ExAppHttpRequestOptions = {},
): Promise<ExAppHttpResponse> => {
  const req = https.request(validatedUrl.url, {
    method: options.method ?? 'GET',
    headers: options.headers ? { ...options.headers } : undefined,
    lookup: ((_hostname, lookupOptions, callback) => {
      if (typeof lookupOptions === 'object' && lookupOptions.all) {
        callback(
          null,
          validatedUrl.addresses.map(({ address, family }) => ({ address, family })),
        );
        return;
      }
      const { address, family } = validatedUrl.addresses[0];
      callback(null, address, family);
    }) as NonNullable<https.RequestOptions['lookup']>,
  });
  return new Promise((resolve, reject) => {
    req.on('error', reject);
    req.on('response', (response) => {
      if (
        response.statusCode !== undefined &&
        response.statusCode >= 300 &&
        response.statusCode < 400
      ) {
        response.destroy();
        response.resume();
        reject(new UnsafeExAppUrlError('AIアプリのリダイレクト応答は許可されていません。'));
        return;
      }

      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('error', reject);
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        const status = response.statusCode ?? 0;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          text: async () => body,
          json: async () => JSON.parse(body),
        });
      });
    });
    req.end(options.body);
  });
};
