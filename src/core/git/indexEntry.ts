// 依 it-tooools-0.1.0.vsix 的編譯結果還原（原始檔遺失）；邏輯與 0.1.0 相同，註解為重寫。
// 格式參考 git 的 Documentation/gitformat-index.txt。

const HEADER_BYTES = 12;
// ctime(8) mtime(8) dev ino mode uid gid size 各 4 bytes，之後才是物件 ID
const STAT_BYTES = 40;
const MTIME_SEC_OFFSET = 8;
const MTIME_NSEC_OFFSET = 12;
const SIZE_OFFSET = 36;

const FLAG_ASSUME_VALID = 0x8000;
const FLAG_EXTENDED = 0x4000;
const FLAG_STAGE_MASK = 0x3000;
const FLAG_NAME_MASK = 0x0fff;
const EXTENDED_SKIP_WORKTREE = 0x4000;
const EXTENDED_INTENT_TO_ADD = 0x2000;

export interface IndexEntry {
  oid: string;
  mtimeSec: number;
  mtimeNsec: number;
  size: number;
  stage: number;
  assumeUnchanged: boolean;
  skipWorktree: boolean;
  intentToAdd: boolean;
}

export type IndexLookup = { status: 'found'; entry: IndexEntry } | { status: 'missing' } | { status: 'unreadable' };

const UNREADABLE: IndexLookup = { status: 'unreadable' };

/**
 * 在 `.git/index`（版本 2–4）中找第一個名稱等於任一候選路徑的項目。
 * `oidLength` 是物件 ID 的位元組數：SHA-1 為 20，SHA-256 儲存庫為 32。
 */
export function findIndexEntry(buffer: Buffer, paths: string[], oidLength = 20): IndexLookup {
  if (buffer.length < HEADER_BYTES || buffer.toString('latin1', 0, 4) !== 'DIRC') {
    return UNREADABLE;
  }
  const version = buffer.readUInt32BE(4);
  if (version < 2 || version > 4) {
    return UNREADABLE;
  }
  const targets = paths.map((p) => Buffer.from(p, 'utf8'));
  const count = buffer.readUInt32BE(8);
  let offset = HEADER_BYTES;
  let previous: Buffer = Buffer.alloc(0);

  for (let index = 0; index < count; index += 1) {
    const start = offset;
    const flagsOffset = start + STAT_BYTES + oidLength;
    if (flagsOffset + 2 > buffer.length) {
      return UNREADABLE;
    }
    const flags = buffer.readUInt16BE(flagsOffset);
    const extended = (flags & FLAG_EXTENDED) !== 0;
    if (extended && flagsOffset + 4 > buffer.length) {
      return UNREADABLE;
    }
    const extendedFlags = extended ? buffer.readUInt16BE(flagsOffset + 2) : 0;
    let cursor = flagsOffset + (extended ? 4 : 2);
    let name: Buffer;

    if (version === 4) {
      // 前綴壓縮：先讀要從上一個名稱尾端刪掉幾個位元組（git 的 offset varint），再接上本項的後綴
      let strip = 0;
      let byte: number;
      let first = true;
      do {
        if (cursor >= buffer.length) {
          return UNREADABLE;
        }
        byte = buffer[cursor];
        cursor += 1;
        strip = first ? byte & 0x7f : ((strip + 1) << 7) | (byte & 0x7f);
        first = false;
      } while (byte & 0x80);
      const terminator = buffer.indexOf(0, cursor);
      if (terminator === -1 || strip > previous.length) {
        return UNREADABLE;
      }
      name = Buffer.concat([previous.subarray(0, previous.length - strip), buffer.subarray(cursor, terminator)]);
      previous = name;
      offset = terminator + 1;
    } else {
      let nameLength = flags & FLAG_NAME_MASK;
      // 名稱長度滿格（≥ 0xFFF）時旗標存不下，要找 NUL 結尾
      if (nameLength === FLAG_NAME_MASK) {
        const terminator = buffer.indexOf(0, cursor);
        if (terminator === -1) {
          return UNREADABLE;
        }
        nameLength = terminator - cursor;
      }
      if (cursor + nameLength > buffer.length) {
        return UNREADABLE;
      }
      name = buffer.subarray(cursor, cursor + nameLength);
      // 版本 2、3 每個項目以 1–8 個 NUL 補齊到 8 的倍數
      offset += (cursor - offset + nameLength + 8) & ~7;
    }

    if (targets.some((target) => target.equals(name))) {
      return {
        status: 'found',
        entry: {
          oid: buffer.toString('hex', start + STAT_BYTES, flagsOffset),
          mtimeSec: buffer.readUInt32BE(start + MTIME_SEC_OFFSET),
          mtimeNsec: buffer.readUInt32BE(start + MTIME_NSEC_OFFSET),
          size: buffer.readUInt32BE(start + SIZE_OFFSET),
          stage: (flags & FLAG_STAGE_MASK) >> 12,
          assumeUnchanged: (flags & FLAG_ASSUME_VALID) !== 0,
          skipWorktree: (extendedFlags & EXTENDED_SKIP_WORKTREE) !== 0,
          intentToAdd: (extendedFlags & EXTENDED_INTENT_TO_ADD) !== 0,
        },
      };
    }
  }
  return { status: 'missing' };
}
