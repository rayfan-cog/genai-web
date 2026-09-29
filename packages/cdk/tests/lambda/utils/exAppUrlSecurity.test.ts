import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as dns from 'node:dns/promises';
import * as https from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertPublicEndpointUrl,
  assertPublicStatusUrl,
  parseHttpsUrl,
  requestValidatedExAppUrl,
  resolveRelativeStatusUrl,
  toRelativeStatusUrl,
  UnsafeExAppUrlError,
} from '../../../lambda/utils/exAppUrlSecurity';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));

const publicAddresses = [
  { address: '93.184.215.14', family: 4 as const },
  { address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6 as const },
];

const createRequest = (status: number, body: string) => {
  const request = new EventEmitter() as EventEmitter & { end: (body?: string) => void };
  request.end = vi.fn(() => {
    queueMicrotask(() => {
      const response = new PassThrough() as PassThrough & { statusCode: number };
      response.statusCode = status;
      request.emit('response', response);
      response.end(body);
    });
  });
  vi.mocked(https.request).mockReturnValue(request as never);
  return request;
};

describe('exAppUrlSecurity', () => {
  beforeEach(() => {
    vi.mocked(dns.lookup).mockReset();
    vi.mocked(dns.lookup).mockResolvedValue(publicAddresses);
    vi.mocked(https.request).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseHttpsUrl', () => {
    it('HTTPS URLをパースする', () => {
      const url = parseHttpsUrl('https://api.example.com/invoke?x=1');

      expect(url.toString()).toBe('https://api.example.com/invoke?x=1');
    });

    it.each([
      'http://api.example.com/invoke',
      'file:///etc/passwd',
      'https://user:pass@api.example.com/invoke',
      'https://api.example.com/invoke#fragment',
      ' https://api.example.com/invoke',
      'https://api.example.com/invoke\n',
      'not-a-url',
    ])('不正なendpoint URLを拒否する: %s', (value) => {
      expect(() => parseHttpsUrl(value)).toThrow(UnsafeExAppUrlError);
    });
  });

  describe('assertPublicEndpointUrl', () => {
    it('public IPに解決されるHTTPSホスト名を許可する', async () => {
      const result = await assertPublicEndpointUrl('https://api.example.com/invoke');

      expect(result.url.hostname).toBe('api.example.com');
      expect(result.addresses).toEqual(publicAddresses);
      expect(dns.lookup).toHaveBeenCalledWith('api.example.com', {
        all: true,
        verbatim: true,
      });
    });

    it.each([
      '10.0.0.5',
      '172.16.0.1',
      '192.168.1.1',
      '127.0.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ])('内部アドレスに解決されるホスト名を拒否する: %s', async (address) => {
      vi.mocked(dns.lookup).mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);

      await expect(
        assertPublicEndpointUrl('https://api.example.com/invoke'),
      ).rejects.toBeInstanceOf(UnsafeExAppUrlError);
    });

    it('publicとprivateの両方に解決されるホスト名を拒否する', async () => {
      vi.mocked(dns.lookup).mockResolvedValue([
        publicAddresses[0],
        { address: '10.0.0.5', family: 4 },
      ]);

      await expect(
        assertPublicEndpointUrl('https://api.example.com/invoke'),
      ).rejects.toBeInstanceOf(UnsafeExAppUrlError);
    });

    it('DNS lookupが失敗したら拒否する', async () => {
      vi.mocked(dns.lookup).mockRejectedValue(new Error('ENOTFOUND'));

      await expect(
        assertPublicEndpointUrl('https://api.example.com/invoke'),
      ).rejects.toBeInstanceOf(UnsafeExAppUrlError);
    });

    it('DNS lookup結果が空なら拒否する', async () => {
      vi.mocked(dns.lookup).mockResolvedValue([]);

      await expect(
        assertPublicEndpointUrl('https://api.example.com/invoke'),
      ).rejects.toBeInstanceOf(UnsafeExAppUrlError);
    });

    it('public IP literalを許可しDNS lookupしない', async () => {
      const result = await assertPublicEndpointUrl('https://8.8.8.8/invoke');

      expect(result.url.hostname).toBe('8.8.8.8');
      expect(result.addresses).toEqual([{ address: '8.8.8.8', family: 4 }]);
      expect(dns.lookup).not.toHaveBeenCalled();
    });

    it('public IPv6 literalを許可しDNS lookupしない', async () => {
      const result = await assertPublicEndpointUrl('https://[2001:4860:4860::8888]/invoke');

      expect(result.url.hostname).toBe('[2001:4860:4860::8888]');
      expect(result.addresses).toEqual([{ address: '2001:4860:4860::8888', family: 6 }]);
      expect(dns.lookup).not.toHaveBeenCalled();
    });

    it.each([
      'https://localhost/invoke',
      'https://LOCALHOST/invoke',
      'https://localhost./invoke',
      'https://./invoke',
      'https://.../invoke',
      'https://api.localhost/invoke',
      'https://api.localhost./invoke',
      'https://127.0.0.1/invoke',
      'https://127.0.0.1./invoke',
      'https://127.1/invoke',
      'https://0177.0.0.1/invoke',
      'https://127.000.000.001/invoke',
      'https://2130706433/invoke',
      'https://0x7f000001/invoke',
      'https://0.0.0.0/invoke',
      'https://255.255.255.255/invoke',
      'https://224.0.0.1/invoke',
      'https://[::1]/invoke',
      'https://[::]/invoke',
      'https://[fe80::1]/invoke',
      'https://[fd00::1]/invoke',
      'https://[ff02::1]/invoke',
      'https://[2001:db8::1]/invoke',
      'https://[::ffff:127.0.0.1]/invoke',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.1/invoke',
      'https://172.16.0.1/invoke',
      'https://192.168.0.1/invoke',
      'https://100.64.0.1/invoke',
      'https://203.0.113.10/invoke',
    ])('内部・特殊用途IP literalを拒否する: %s', async (value) => {
      await expect(assertPublicEndpointUrl(value)).rejects.toBeInstanceOf(UnsafeExAppUrlError);
    });
  });

  describe('resolveRelativeStatusUrl', () => {
    it('相対status_urlをendpoint originに解決し、endpoint addressesを保持する', async () => {
      const endpoint = await assertPublicEndpointUrl('https://api.example.com/prod/invoke');

      const result = resolveRelativeStatusUrl('/status/123?poll=1', endpoint);

      expect(result.url.toString()).toBe('https://api.example.com/status/123?poll=1');
      expect(result.addresses).toEqual(endpoint.addresses);
      expect(toRelativeStatusUrl(result.url)).toBe('/status/123?poll=1');
    });

    it.each([
      'https://evil.example/status/123',
      'http://10.0.0.5/internal-service',
      '//evil.example/status/123',
      '/\\evil.example/status/123',
      '\t/status/123',
      '/status/123#fragment',
      'status/123',
      '',
    ])('不正なstatus_urlを拒否する: %s', async (statusUrl) => {
      const endpoint = await assertPublicEndpointUrl('https://api.example.com/invoke');

      expect(() => resolveRelativeStatusUrl(statusUrl, endpoint)).toThrow(UnsafeExAppUrlError);
    });

    it.each(['/%2F%2Fevil.example/status', '/%5Cevil.example/status'])(
      'エンコード済みの紛らわしいstatus_urlも同一originのパスとして扱う: %s',
      async (statusUrl) => {
        const endpoint = await assertPublicEndpointUrl('https://api.example.com/invoke');

        const result = resolveRelativeStatusUrl(statusUrl, endpoint);

        expect(result.url.origin).toBe('https://api.example.com');
        expect(toRelativeStatusUrl(result.url)).toBe(statusUrl);
      },
    );

    it('assertPublicStatusUrlはendpoint検証とstatus_url解決をまとめて行う', async () => {
      const result = await assertPublicStatusUrl(
        '/prod/status/123',
        'https://api.example.com/prod/invoke',
      );

      expect(result.url.toString()).toBe('https://api.example.com/prod/status/123');
      expect(result.addresses).toEqual(publicAddresses);
    });
  });

  describe('requestValidatedExAppUrl', () => {
    it('method、headers、body、pinned lookupを使って外部リクエストを送信する', async () => {
      const request = createRequest(200, '{"ok":true}');
      const endpoint = await assertPublicEndpointUrl('https://api.example.com/invoke');

      const result = await requestValidatedExAppUrl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"input":"test"}',
      });

      expect(result.status).toBe(200);
      expect(https.request).toHaveBeenCalledWith(endpoint.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        lookup: expect.any(Function),
      });
      expect(request.end).toHaveBeenCalledWith('{"input":"test"}');

      const options = vi.mocked(https.request).mock.calls[0][1]!;
      const lookup = options.lookup as unknown as (
        hostname: string,
        options: { all?: boolean },
        callback: (...args: unknown[]) => void,
      ) => void;
      const callback = vi.fn();
      lookup('attacker-rebind.example', { all: true }, callback);
      expect(callback).toHaveBeenCalledWith(null, publicAddresses);
      lookup('attacker-rebind.example', {}, callback);
      expect(callback).toHaveBeenLastCalledWith(
        null,
        publicAddresses[0].address,
        publicAddresses[0].family,
      );
    });

    it('method未指定時はGETでbodyなしの外部リクエストを送信する', async () => {
      const request = createRequest(200, '{"ok":true}');
      const endpoint = await assertPublicEndpointUrl('https://api.example.com/invoke');

      await requestValidatedExAppUrl(endpoint);

      expect(https.request).toHaveBeenCalledWith(endpoint.url, {
        method: 'GET',
        headers: undefined,
        lookup: expect.any(Function),
      });
      expect(request.end).toHaveBeenCalledWith(undefined);
    });

    it('redirectレスポンスを拒否する', async () => {
      createRequest(302, '');
      const endpoint = await assertPublicEndpointUrl('https://api.example.com/invoke');

      await expect(requestValidatedExAppUrl(endpoint)).rejects.toBeInstanceOf(UnsafeExAppUrlError);
    });

    it('JSON bodyを解析した後もtextで読み取れる', async () => {
      createRequest(200, '{"ok":true}');
      const endpoint = await assertPublicEndpointUrl('https://api.example.com/invoke');

      const response = await requestValidatedExAppUrl(endpoint);

      expect(await response.json()).toEqual({ ok: true });
      expect(await response.text()).toBe('{"ok":true}');
    });

    it('JSONでないbodyでもjsonは失敗しtextは読み取れる', async () => {
      createRequest(200, 'not json');
      const endpoint = await assertPublicEndpointUrl('https://api.example.com/invoke');

      const response = await requestValidatedExAppUrl(endpoint);

      await expect(response.json()).rejects.toThrow();
      expect(await response.text()).toBe('not json');
    });

    it('request errorでrejectする', async () => {
      const request = new EventEmitter() as EventEmitter & { end: (body?: string) => void };
      request.end = vi.fn(() => {
        queueMicrotask(() => request.emit('error', new Error('network error')));
      });
      vi.mocked(https.request).mockReturnValue(request as never);
      const endpoint = await assertPublicEndpointUrl('https://api.example.com/invoke');

      await expect(requestValidatedExAppUrl(endpoint)).rejects.toThrow('network error');
    });
  });
});
