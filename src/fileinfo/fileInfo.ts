// 目前檔案資訊。只在使用者按重新整理時被呼叫一次，這裡不掛任何監聽。
import { execFile } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { formatMode, humanSize, probeContent } from '../core/fileprobe/probe';
import { relativeTime } from '../core/encode/jwt';
import type { FileInfo } from '../shared/protocol';
import { gitFileStatus } from './gitStatus';

/** 大檔只讀開頭這麼多位元組做內容分析，避免一次讀進數 GB。 */
const PROBE_LIMIT = 16 * 1024 * 1024;

function run(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 2000 }, (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined));
  });
}

async function groupName(gid: number): Promise<string | undefined> {
  try {
    const content = await fs.readFile('/etc/group', 'utf8');
    for (const line of content.split('\n')) {
      const [name, , id] = line.split(':');
      if (!line.startsWith('#') && Number(id) === gid) {
        return name;
      }
    }
  } catch {
    // Windows 沒有 /etc/group
  }
  return undefined;
}

async function readHead(file: string, size: number): Promise<Uint8Array> {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(size, PROBE_LIMIT));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return new Uint8Array(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** 以目前執行 VS Code 的使用者身分實測，不是從權限位元推算：ACL、唯讀掛載都會反映出來。 */
async function accessSummary(file: string): Promise<string> {
  const can = (mode: number) => fs.access(file, mode).then(() => '✓', () => '✗');
  const [read, write, execute] = await Promise.all([can(constants.R_OK), can(constants.W_OK), can(constants.X_OK)]);
  return `讀取 ${read}・編輯 ${write}・執行 ${execute}`;
}

function timeRow(label: string, date: Date | undefined, now: number): FileInfo['times'][number] | undefined {
  if (!date || date.getTime() <= 0) {
    return undefined;
  }
  const local = date.toLocaleString('zh-TW', { hour12: false });
  return { label, value: local, relative: relativeTime(Math.floor(date.getTime() / 1000), Math.floor(now / 1000)) };
}

export async function collectFileInfo(document: vscode.TextDocument, resolveOwner: boolean): Promise<FileInfo> {
  const now = Date.now();
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const base = {
    fileName: path.basename(document.fileName),
    languageId: document.languageId,
    isDirty: document.isDirty,
    readAt: now,
  };

  if (document.uri.scheme !== 'file') {
    // 未存檔或虛擬文件：沒有磁碟上的檔案，只分析編輯器內容
    const bytes = new Uint8Array(Buffer.from(document.getText(), 'utf8'));
    return {
      ...base,
      path: document.uri.toString(),
      relativePath: null,
      projectRoot: null,
      projectRootKind: null,
      projectRelativePath: null,
      summary: null,
      folder: '',
      isUntitled: document.isUntitled,
      symlinkTarget: null,
      size: null,
      mode: null,
      owner: null,
      group: null,
      nlink: null,
      times: [],
      probe: probeContent(bytes),
      truncatedAt: null,
    };
  }

  const file = document.uri.fsPath;
  const [lstat, stat] = await Promise.all([fs.lstat(file), fs.stat(file)]);
  const symlinkTarget = lstat.isSymbolicLink() ? await fs.readlink(file) : null;
  const [ownerName, group] = await Promise.all([
    resolveOwner && process.platform !== 'win32' ? run('id', ['-un', String(stat.uid)]) : Promise.resolve(undefined),
    process.platform !== 'win32' ? groupName(stat.gid) : Promise.resolve(undefined),
  ]);
  const bytes = await readHead(file, stat.size);
  const [git, access] = await Promise.all([gitFileStatus(file), accessSummary(file)]);
  const projectRoot = git.root ?? workspaceFolder?.uri.fsPath ?? null;

  return {
    ...base,
    path: file,
    relativePath: workspaceFolder ? path.relative(workspaceFolder.uri.fsPath, file) : null,
    projectRoot,
    projectRootKind: git.root ? 'git' : workspaceFolder ? 'workspace' : null,
    projectRelativePath: projectRoot ? path.relative(projectRoot, file) : null,
    summary: {
      workspace: workspaceFolder ? `是（${workspaceFolder.name}）` : '否',
      gitRepo: git.root ? `是（${path.basename(git.root)}）` : '否',
      gitTracking: git.tracking,
      access,
    },
    folder: path.dirname(file),
    isUntitled: false,
    symlinkTarget,
    size: humanSize(stat.size),
    mode: process.platform === 'win32' ? null : formatMode(stat.mode),
    owner: process.platform === 'win32' ? null : `${ownerName ?? '（未解析）'}（uid ${stat.uid}）`,
    group: process.platform === 'win32' ? null : `${group ?? '（未解析）'}（gid ${stat.gid}）`,
    nlink: stat.nlink,
    times: [
      timeRow('建立時間（birthtime）', stat.birthtime, now),
      timeRow('內容修改（mtime）', stat.mtime, now),
      timeRow('屬性變更（ctime）', stat.ctime, now),
      timeRow('最後存取（atime）', stat.atime, now),
    ].filter((row): row is FileInfo['times'][number] => row !== undefined),
    probe: probeContent(bytes),
    truncatedAt: stat.size > PROBE_LIMIT ? PROBE_LIMIT : null,
  };
}
