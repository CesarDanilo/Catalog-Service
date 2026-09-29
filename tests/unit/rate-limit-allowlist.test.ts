import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { isAllowListed, parseAllowList } from '../../src/shared/http/rate-limit-allowlist.js';

async function remoteAddressOf(address: string, allowList: string, forwardedFor?: string) {
  const app = Fastify({ trustProxy: true });
  const list = parseAllowList(allowList);
  app.get('/', async (request) => ({ allowed: isAllowListed(list, request) }));
  const response = await app.inject({
    method: 'GET',
    url: '/',
    remoteAddress: address,
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  });
  await app.close();
  return response.json<{ allowed: boolean }>().allowed;
}

describe('RATE_LIMIT_ALLOWLIST', () => {
  it('aceita IPs e redes (IPv4/IPv6)', async () => {
    const allow = '172.31.37.117, 10.0.0.0/8, ::1';
    expect(await remoteAddressOf('172.31.37.117', allow)).toBe(true);
    expect(await remoteAddressOf('10.20.30.40', allow)).toBe(true);
    expect(await remoteAddressOf('::1', allow)).toBe(true);
    expect(await remoteAddressOf('::ffff:172.31.37.117', allow)).toBe(true);
    expect(await remoteAddressOf('172.31.37.118', allow)).toBe(false);
  });

  it('vazio não libera ninguém', async () => {
    expect(await remoteAddressOf('127.0.0.1', '')).toBe(false);
  });

  it('X-Forwarded-For forjado não libera (vale o IP da conexão)', async () => {
    expect(await remoteAddressOf('203.0.113.9', '172.31.37.117', '172.31.37.117')).toBe(false);
  });

  it.each(['backend', '300.1.1.1', '10.0.0.0/33', '10.0.0.0/x'])(
    'entrada inválida "%s" derruba o startup',
    (entry) => {
      expect(() => parseAllowList(entry)).toThrow(/RATE_LIMIT_ALLOWLIST/);
    },
  );
});
