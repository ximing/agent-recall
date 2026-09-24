import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from '../errors.js';

/** 保存精排地址失败时的固定文案。不要把被拒绝的主机拼进错误。 */
export const RERANK_URL_REJECTED_MESSAGE = '精排地址必须是公网 HTTPS';

export type DnsResolver = (hostname: string) => Promise<readonly string[]>;

export interface RerankUrlGuardOptions {
  /** 仅 `production` 启用公网 HTTPS 策略。缺省时读 `APP_ENV`。 */
  appEnv?: string;
  /** 测试注入 DNS，避免真实解析。 */
  resolve?: DnsResolver;
}

const IPV4_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

// 落在 2000::/3 内、但仍不是可访问的公网单播。
const IPV6_BLOCKS: ReadonlyArray<readonly [string, number]> = [
  ['2001:db8::', 32],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2002::', 16],
];

function rejected(): AppError {
  return new AppError(400, 'VALIDATION', RERANK_URL_REJECTED_MESSAGE);
}

function isProduction(appEnv: string | undefined): boolean {
  return (appEnv ?? process.env.APP_ENV ?? '').trim() === 'production';
}

function normalizeHostname(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.replace(/\.+$/, '');
  return host;
}

function isBlockedHostname(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal');
}

/** URL 解析器若保留十进制 / 八进制 / 十六进制写法，仍视为 IP 字面量。 */
function isIpLiteral(host: string): boolean {
  if (isIP(host) !== 0) return true;
  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(host)) return true;
  const labels = host.split('.');
  return (
    labels.length >= 2 &&
    labels.length <= 4 &&
    labels.every((label) => /^(?:0x[0-9a-f]+|\d+)$/i.test(label))
  );
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value * 256 + octet) >>> 0;
  }
  return value;
}

function ipv4Matches(ip: number, base: string, bits: number): boolean {
  const network = ipv4ToInt(base);
  if (network === null) return false;
  const mask = bits >= 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (network & mask);
}

function isPublicIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return !IPV4_BLOCKS.some(([base, bits]) => ipv4Matches(value, base, bits));
}

function expandIpv6(input: string): number[] | null {
  let text = input.trim().toLowerCase();
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (side.length === 0) return [];
    const parts = side.split(':');
    const groups: number[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? '';
      if (part.includes('.')) {
        if (index !== parts.length - 1) return null;
        const v4 = ipv4ToInt(part);
        if (v4 === null) return null;
        groups.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  if (halves.length === 1) {
    const groups = parseSide(text);
    return groups && groups.length === 8 ? groups : null;
  }
  const head = parseSide(halves[0] ?? '');
  const tail = parseSide(halves[1] ?? '');
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function ipv6Matches(groups: readonly number[], base: string, bits: number): boolean {
  const network = expandIpv6(base);
  if (!network) return false;
  let remaining = bits;
  for (let index = 0; index < 8; index += 1) {
    if (remaining <= 0) return true;
    const take = Math.min(16, remaining);
    const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff;
    if (((groups[index] ?? 0) & mask) !== ((network[index] ?? 0) & mask)) return false;
    remaining -= take;
  }
  return true;
}

function isPublicUnicast(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  const kind = isIP(normalized);
  if (kind === 4) return isPublicIpv4(normalized);
  if (kind !== 6) return false;
  const groups = expandIpv6(normalized);
  if (!groups) return false;
  // 2000::/3 以外都不是 IPv6 公网单播（含 loopback、ULA、链路本地、组播、映射地址）。
  if ((groups[0] & 0xe000) !== 0x2000) return false;
  return !IPV6_BLOCKS.some(([base, bits]) => ipv6Matches(groups, base, bits));
}

async function defaultResolve(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/**
 * 生产环境只接受解析到公网单播的 HTTPS 主机名。
 * 其它环境仍允许测试替身（http://127.0.0.1:port），但拒绝非 http(s)。
 */
export async function assertRerankBaseUrl(rawUrl: string, options: RerankUrlGuardOptions = {}): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw rejected();
  }
  const production = isProduction(options.appEnv);
  if (!production) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw rejected();
    return;
  }
  if (url.protocol !== 'https:') throw rejected();
  if (url.username !== '' || url.password !== '') throw rejected();
  const host = normalizeHostname(url.hostname);
  if (host.length === 0 || isBlockedHostname(host) || isIpLiteral(host)) throw rejected();
  const resolve = options.resolve ?? defaultResolve;
  let addresses: readonly string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw rejected();
  }
  if (addresses.length === 0 || addresses.some((address) => !isPublicUnicast(address))) throw rejected();
}
