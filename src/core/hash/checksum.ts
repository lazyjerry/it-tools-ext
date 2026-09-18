// 32 位元校驗和：Node crypto 沒有，依 PHP hash() 的輸出位元組順序自行實作。

function reflectedTable(poly: number): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? (c >>> 1) ^ poly : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function normalTable(poly: number): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n << 24;
    for (let k = 0; k < 8; k += 1) {
      c = c & 0x80000000 ? (c << 1) ^ poly : c << 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC32B_TABLE = reflectedTable(0xedb88320);
const CRC32C_TABLE = reflectedTable(0x82f63b78);
const BZIP2_TABLE = normalTable(0x04c11db7);

function reflectedCrc(table: Uint32Array, data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) {
    c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function toBigEndian(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

/** 標準 CRC-32（zlib）：PHP crc32() 與 hash('crc32b')、Java java.util.zip.CRC32。 */
export function crc32bValue(data: Uint8Array): number {
  return reflectedCrc(CRC32B_TABLE, data);
}

export function crc32b(data: Uint8Array): Uint8Array {
  return toBigEndian(crc32bValue(data));
}

/** PHP hash('crc32')：CRC-32/BZIP2，且 PHP 以小端序輸出位元組，所以 hex 與 BZIP2 標準值前後顛倒。 */
export function crc32Bzip2Php(data: Uint8Array): Uint8Array {
  let c = 0xffffffff;
  for (const byte of data) {
    c = (BZIP2_TABLE[((c >>> 24) ^ byte) & 0xff] ^ (c << 8)) >>> 0;
  }
  return toBigEndian(c ^ 0xffffffff).reverse();
}

/** CRC-32C（Castagnoli）：PHP hash('crc32c')、Java 9+ java.util.zip.CRC32C。 */
export function crc32c(data: Uint8Array): Uint8Array {
  return toBigEndian(reflectedCrc(CRC32C_TABLE, data));
}

export function adler32(data: Uint8Array): Uint8Array {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return toBigEndian(((b << 16) | a) >>> 0);
}
