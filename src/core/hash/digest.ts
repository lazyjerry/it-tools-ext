// Node crypto 摘要演算法清單與執行期可用性偵測（OpenSSL 3 把 md4／whirlpool 移到 legacy provider，各環境不一定有）。
import { createHash, createHmac } from 'node:crypto';

export interface DigestDef {
  id: string;
  node: string;
  /** PHP hash() 的演算法名稱；null 表示 PHP 沒有。 */
  php: string | null;
  /** Java MessageDigest 名稱；null 表示 JDK 沒有內建。 */
  java: string | null;
}

export const DIGESTS: readonly DigestDef[] = [
  { id: 'md4', node: 'md4', php: 'md4', java: null },
  { id: 'md5', node: 'md5', php: 'md5', java: 'MD5' },
  { id: 'sha1', node: 'sha1', php: 'sha1', java: 'SHA-1' },
  { id: 'sha224', node: 'sha224', php: 'sha224', java: 'SHA-224' },
  { id: 'sha256', node: 'sha256', php: 'sha256', java: 'SHA-256' },
  { id: 'sha384', node: 'sha384', php: 'sha384', java: 'SHA-384' },
  { id: 'sha512', node: 'sha512', php: 'sha512', java: 'SHA-512' },
  { id: 'sha512/224', node: 'sha512-224', php: 'sha512/224', java: 'SHA-512/224' },
  { id: 'sha512/256', node: 'sha512-256', php: 'sha512/256', java: 'SHA-512/256' },
  { id: 'sha3-224', node: 'sha3-224', php: 'sha3-224', java: 'SHA3-224' },
  { id: 'sha3-256', node: 'sha3-256', php: 'sha3-256', java: 'SHA3-256' },
  { id: 'sha3-384', node: 'sha3-384', php: 'sha3-384', java: 'SHA3-384' },
  { id: 'sha3-512', node: 'sha3-512', php: 'sha3-512', java: 'SHA3-512' },
  { id: 'ripemd160', node: 'ripemd160', php: 'ripemd160', java: null },
  { id: 'whirlpool', node: 'whirlpool', php: 'whirlpool', java: null },
  { id: 'blake2b512', node: 'blake2b512', php: null, java: null },
  { id: 'blake2s256', node: 'blake2s256', php: null, java: null },
  { id: 'sm3', node: 'sm3', php: null, java: null },
];

let available: DigestDef[] | undefined;

/** 列在 getHashes() 不代表真的能算，實際 digest 一次才算數。 */
export function availableDigests(): DigestDef[] {
  if (!available) {
    available = DIGESTS.filter((def) => {
      try {
        createHash(def.node).update('probe').digest();
        return true;
      } catch {
        return false;
      }
    });
  }
  return available;
}

export function digest(def: DigestDef, data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash(def.node).update(data).digest());
}

export function hmac(def: DigestDef, key: Uint8Array, data: Uint8Array): Uint8Array {
  return new Uint8Array(createHmac(def.node, key).update(data).digest());
}

/** PHP 8.4 hash_algos() 全表，用來列出「PHP 有、本工具算不出來」的演算法。 */
export const PHP_HASH_ALGOS: readonly string[] = [
  'md2', 'md4', 'md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512/224', 'sha512/256', 'sha512',
  'sha3-224', 'sha3-256', 'sha3-384', 'sha3-512', 'ripemd128', 'ripemd160', 'ripemd256', 'ripemd320',
  'whirlpool', 'tiger128,3', 'tiger160,3', 'tiger192,3', 'tiger128,4', 'tiger160,4', 'tiger192,4',
  'snefru', 'snefru256', 'gost', 'gost-crypto', 'adler32', 'crc32', 'crc32b', 'crc32c',
  'fnv132', 'fnv1a32', 'fnv164', 'fnv1a64', 'joaat', 'murmur3a', 'murmur3c', 'murmur3f',
  'xxh32', 'xxh64', 'xxh3', 'xxh128',
  'haval128,3', 'haval160,3', 'haval192,3', 'haval224,3', 'haval256,3',
  'haval128,4', 'haval160,4', 'haval192,4', 'haval224,4', 'haval256,4',
  'haval128,5', 'haval160,5', 'haval192,5', 'haval224,5', 'haval256,5',
];
