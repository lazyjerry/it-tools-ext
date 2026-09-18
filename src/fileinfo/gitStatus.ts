// 檔案的 git 狀態：只讀 .git 底下的檔案，不呼叫 git、不用 VS Code 的 Git API，沒裝 git 也能用。
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { findIndexEntry } from '../core/git/indexEntry';
import type { IndexEntry } from '../core/git/indexEntry';

/** 超過這個大小就不為了比對而整檔讀進來算雜湊。 */
const HASH_LIMIT = 16 * 1024 * 1024;

export interface GitFileStatus {
  /** 工作樹根目錄；不在任何 repo 內時為 null。 */
  root: string | null;
  tracking: string;
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** 往上找 .git：一般 repo 是目錄；worktree 與 submodule 是內容為 `gitdir: <path>` 的文字檔。 */
async function discover(file: string): Promise<{ root: string; gitDir: string } | undefined> {
  let dir = path.dirname(file);
  for (;;) {
    const dotGit = path.join(dir, '.git');
    const stat = await fs.stat(dotGit).catch(() => undefined);
    if (stat?.isDirectory()) {
      return { root: dir, gitDir: dotGit };
    }
    if (stat?.isFile()) {
      const target = /^gitdir:\s*(.+)$/m.exec((await readText(dotGit)) ?? '')?.[1].trim();
      if (target) {
        return { root: dir, gitDir: path.resolve(dir, target) };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

async function oidLength(gitDir: string): Promise<number> {
  // worktree 的 config 放在共用的主 .git，位置記在 commondir
  const common = (await readText(path.join(gitDir, 'commondir')))?.trim();
  const config = await readText(path.join(common ? path.resolve(gitDir, common) : gitDir, 'config'));
  return /^\s*objectformat\s*=\s*sha256\s*$/im.test(config ?? '') ? 32 : 20;
}

function blobOid(content: Buffer, algorithm: string): string {
  return createHash(algorithm).update(`blob ${content.length}\0`).update(content).digest('hex');
}

/** 照 git 自己的順序判斷：先比 stat（大小、mtime），對不上才算 blob 雜湊。 */
async function sameAsIndex(file: string, entry: IndexEntry, algorithm: string): Promise<boolean | undefined> {
  const stat = await fs.lstat(file, { bigint: true });
  if (Number(stat.size & 0xffffffffn) !== entry.size) {
    return false;
  }
  const sec = Number(stat.mtimeNs / 1_000_000_000n);
  const nsec = Number(stat.mtimeNs % 1_000_000_000n);
  if (sec === entry.mtimeSec && (entry.mtimeNsec === 0 || nsec === entry.mtimeNsec)) {
    return true;
  }
  if (stat.size > BigInt(HASH_LIMIT)) {
    return undefined;
  }
  const content = stat.isSymbolicLink() ? Buffer.from(await fs.readlink(file)) : await fs.readFile(file);
  if (blobOid(content, algorithm) === entry.oid) {
    return true;
  }
  // autocrlf／text 屬性會讓 index 裡存的是 LF 版本
  return content.includes('\r\n') && blobOid(Buffer.from(content.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'), algorithm) === entry.oid;
}

export async function gitFileStatus(file: string): Promise<GitFileStatus> {
  const repo = await discover(file);
  if (!repo) {
    return { root: null, tracking: '—（不在 git repo 內）' };
  }
  const index = await fs.readFile(path.join(repo.gitDir, 'index')).catch(() => undefined);
  if (!index) {
    return { root: repo.root, tracking: '未追蹤（repo 還沒有 index，沒有任何檔案被 add 過）' };
  }
  const relative = path.relative(repo.root, file).split(path.sep).join('/');
  const length = await oidLength(repo.gitDir);
  const lookup = findIndexEntry(index, [...new Set([relative, relative.normalize('NFC'), relative.normalize('NFD')])], length);
  if (lookup.status === 'unreadable') {
    return { root: repo.root, tracking: '無法判斷（.git/index 格式不支援或已損毀）' };
  }
  if (lookup.status === 'missing') {
    return { root: repo.root, tracking: '未追蹤（不在 index，尚未 add）' };
  }

  const { entry } = lookup;
  const marks = [entry.assumeUnchanged && 'assume-unchanged', entry.skipWorktree && 'skip-worktree'].filter(Boolean);
  const suffix = marks.length ? `；已標記 ${marks.join('、')}` : '';
  if (entry.stage !== 0) {
    return { root: repo.root, tracking: `已追蹤；合併衝突尚未解決${suffix}` };
  }
  if (entry.intentToAdd) {
    return { root: repo.root, tracking: `已登記路徑（add -N），內容尚未 add${suffix}` };
  }
  const same = await sameAsIndex(file, entry, length === 32 ? 'sha256' : 'sha1').catch(() => undefined);
  const added = same === undefined ? '檔案過大，未比對內容是否已 add' : same ? '目前內容已 add（與 index 相同）' : '有尚未 add 的修改';
  return { root: repo.root, tracking: `已追蹤；${added}${suffix}` };
}
