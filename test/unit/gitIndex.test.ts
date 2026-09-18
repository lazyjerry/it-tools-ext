import * as assert from 'node:assert/strict';

import { findIndexEntry } from '../../src/core/git/indexEntry';

interface Fixture {
  path: string;
  flags?: number;
  extended?: number;
  size?: number;
  mtimeSec?: number;
}

/** 手工組一份 index：不依賴本機有沒有裝 git，格式細節也看得見。 */
function buildIndex(version: number, entries: Fixture[], oidLength = 20): Buffer {
  const chunks: Buffer[] = [];
  const header = Buffer.alloc(12);
  header.write('DIRC', 'latin1');
  header.writeUInt32BE(version, 4);
  header.writeUInt32BE(entries.length, 8);
  chunks.push(header);
  let previous = Buffer.alloc(0) as Buffer;
  entries.forEach((entry, i) => {
    const name = Buffer.from(entry.path, 'utf8');
    const fixed = Buffer.alloc(40 + oidLength + (entry.extended === undefined ? 2 : 4));
    fixed.writeUInt32BE(entry.mtimeSec ?? 0, 8);
    fixed.writeUInt32BE(entry.size ?? 0, 36);
    fixed.fill(i + 1, 40, 40 + oidLength);
    const flags = (entry.flags ?? 0) | (entry.extended === undefined ? 0 : 0x4000) | Math.min(name.length, 0x0fff);
    fixed.writeUInt16BE(flags, 40 + oidLength);
    if (entry.extended !== undefined) {
      fixed.writeUInt16BE(entry.extended, 40 + oidLength + 2);
    }
    if (version === 4) {
      let common = 0;
      while (common < previous.length && common < name.length && previous[common] === name[common]) {
        common += 1;
      }
      // git 的 offset varint：高位在前，每多一個位元組先減 1
      let strip = previous.length - common;
      const varint = [strip & 0x7f];
      while ((strip >>= 7) > 0) {
        strip -= 1;
        varint.unshift(0x80 | (strip & 0x7f));
      }
      chunks.push(fixed, Buffer.from(varint), name.subarray(common), Buffer.from([0]));
      previous = name;
    } else {
      const length = (fixed.length + name.length + 8) & ~7;
      chunks.push(fixed, name, Buffer.alloc(length - fixed.length - name.length));
    }
  });
  return Buffer.concat(chunks);
}

suite('git index 單一路徑查詢', () => {
  const long = `deep/${'x'.repeat(4200)}.txt`;
  const entries: Fixture[] = [
    { path: 'README.md', size: 120, mtimeSec: 1_790_000_000 },
    { path: long },
    { path: 'src/add-n.ts', extended: 0x2000 },
    { path: 'src/conflict.ts', flags: 0x1000 },
    { path: 'src/ignored.ts', flags: 0x8000, extended: 0x4000 },
    { path: 'src/中文.ts' },
  ];

  for (const version of [2, 3, 4]) {
    test(`版本 ${version}：stat、旗標、名稱長度滿格之後的項目`, () => {
      const index = buildIndex(version, entries);
      const readme = findIndexEntry(index, ['README.md']);
      assert.equal(readme.status, 'found');
      assert.deepEqual(readme.status === 'found' && [readme.entry.size, readme.entry.mtimeSec, readme.entry.oid, readme.entry.stage], [120, 1_790_000_000, '01'.repeat(20), 0]);

      const pick = (p: string) => {
        const hit = findIndexEntry(index, [p]);
        assert.equal(hit.status, 'found', p);
        return hit.status === 'found' ? hit.entry : undefined;
      };
      assert.ok(pick(long));
      assert.equal(pick('src/add-n.ts')?.intentToAdd, true);
      assert.equal(pick('src/conflict.ts')?.stage, 1);
      assert.deepEqual([pick('src/ignored.ts')?.assumeUnchanged, pick('src/ignored.ts')?.skipWorktree], [true, true]);
      assert.equal(findIndexEntry(index, ['src/nope.ts']).status, 'missing');
    });
  }

  test('候選寫法任一個對上就算：NFD 檔名查 NFC 的 index', () => {
    const index = buildIndex(2, entries);
    const nfd = 'src/中文.ts'.normalize('NFD');
    assert.equal(findIndexEntry(index, [nfd, nfd.normalize('NFC')]).status, 'found');
  });

  test('SHA-256 儲存庫的物件 ID 是 32 bytes', () => {
    const index = buildIndex(2, entries, 32);
    const hit = findIndexEntry(index, ['src/中文.ts'], 32);
    assert.equal(hit.status === 'found' && hit.entry.oid, '06'.repeat(32));
    // 長度給錯不會丟例外，只會整份錯位而找不到
    assert.notEqual(findIndexEntry(index, ['src/中文.ts'], 20).status, 'found');
  });

  test('表頭不對、版本不支援、內容截斷都回報讀不到', () => {
    const index = buildIndex(2, entries);
    assert.equal(findIndexEntry(Buffer.from('nope'), ['a']).status, 'unreadable');
    assert.equal(findIndexEntry(buildIndex(5, entries), ['a']).status, 'unreadable');
    assert.equal(findIndexEntry(index.subarray(0, 60), ['src/中文.ts']).status, 'unreadable');
  });
});
