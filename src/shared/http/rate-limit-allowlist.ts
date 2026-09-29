import { BlockList, isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/**
 * IPs/redes que não passam pelo rate limit por IP — o cliente interno (backend do provador), que
 * sozinho faz ~90–130 chamadas numa busca nova (8 lojas: busca por loja, pedidos, acompanhamento).
 *
 * "172.31.37.117, 10.0.0.0/8" -> BlockList. Entrada inválida derruba o startup (config errada
 * não pode virar "ninguém liberado" em silêncio).
 */
export function parseAllowList(value: string): BlockList {
  const list = new BlockList();
  for (const entry of value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)) {
    const [address = '', prefix] = entry.split('/');
    const family = isIP(address);
    if (family === 0) throw new Error(`RATE_LIMIT_ALLOWLIST: invalid IP "${entry}"`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) {
      list.addAddress(address, type);
      continue;
    }
    const bits = Number(prefix);
    if (!Number.isInteger(bits) || bits < 0 || bits > (family === 4 ? 32 : 128)) {
      throw new Error(`RATE_LIMIT_ALLOWLIST: invalid prefix in "${entry}"`);
    }
    list.addSubnet(address, bits, type);
  }
  return list;
}

/**
 * Usa o endereço da CONEXÃO, nunca `request.ip`: com trustProxy, `request.ip` vem do
 * X-Forwarded-For, que qualquer cliente forja.
 */
export function isAllowListed(list: BlockList, request: FastifyRequest): boolean {
  const raw = request.raw.socket.remoteAddress;
  if (!raw) return false;
  // "::ffff:172.31.37.117" (IPv4 numa conexão IPv6) -> "172.31.37.117"
  const address = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  const family = isIP(address);
  return family !== 0 && list.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
