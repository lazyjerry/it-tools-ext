// 直接解 .git/index 二進位，查單一路徑的那一筆：不呼叫 git，也不走 VS Code 的 Git API。
// 格式：12 bytes 表頭（DIRC、版本、筆數），每筆 40 bytes stat 欄位、物件 ID、2 bytes 旗標
// （版本 3 起可再多 2 bytes 擴充旗標）、路徑。版本 2／3 路徑以 NUL 結尾並補齊到 8 的倍數；
// 版本 4 路徑做前綴壓縮（varint「砍掉前一筆尾端幾個位元組」+ 後綴 + NUL），沒有補齊。

const HEADER_BYTES = 12;
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
  /** add 當下工作區檔案的 stat，git 用它判斷「沒變」而不必重算雜湊。size 只有低 32 bits。 */
  mtimeSec: number;
  mtimeNsec: number;
  size: number;
  /** 0 = 正常；1–3 = 合併衝突中的 base／ours／theirs。 */
  stage: number;
  assumeUnchanged: boolean;
  skipWorktree: boolean;
  /** `git add -N`：只登記路徑，內容還沒 add。 */
  intentToAdd: boolean;
}

export type IndexLookup = { status: 'found'; entry: IndexEntry } | { status: 'missing' } | { status: 'unreadable' };

const UNREADABLE: IndexLookup = { status: 'unreadable' };

/**
 * @param paths 同一個檔案的候選寫法（repo 相對、`/` 分隔）。macOS 的檔名可能是 NFC 或 NFD，兩種都要比。
 * @param oidLength SHA-1 是 20，SHA-256 儲存庫是 32；寫錯會從第一筆就整份錯位。
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
      // 與 packfile 的 OFS_DELTA 同一種 varint：每多一個位元組要先 +1 再左移
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
      // 名稱長度欄位只有 12 bits，滿格代表「更長，自己找 NUL」
      let nameLength = flags & FLAG_NAME_MASK;
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
      // 補齊是相對於這一筆的長度，不是檔案位移：表頭 12 bytes 本來就不是 8 的倍數
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
