// 檔案資訊分頁：只在按「重新整理」時讀一次；切換檔案只標示過期，不自動重讀。
import type { FileInfo } from '../../shared/protocol';
import { button, el, row } from '../dom';
import type { TabContext } from '../context';
import { errorMessage } from '../context';

function table(rows: [string, string | null | undefined][]): HTMLTableElement {
  const node = el('table', 'kv');
  for (const [key, value] of rows) {
    if (value === null || value === undefined || value === '') {
      continue;
    }
    const tr = el('tr');
    tr.append(el('th', undefined, key), el('td', 'mono', value));
    node.append(tr);
  }
  return node;
}

/** 一張卡片 = 標題 + key／value 表格；卡片在寬面板並排、窄面板自動換行。 */
function card(title: string, rows: [string, string | null | undefined][], className = ''): HTMLElement {
  const node = el('section', `card ${className}`.trim());
  node.append(el('h3', undefined, title), table(rows));
  return node;
}

export interface FileInfoView {
  root: HTMLElement;
  setActiveFile(name: string | null): void;
  show(info: FileInfo | null): void;
}

export function fileInfoTab(ctx: TabContext): FileInfoView {
  const root = el('div', 'tab');
  const banner = el('div', 'banner hidden');
  const body = el('div');
  let activeFile = ctx.init.activeFile;
  let shownFile: string | null = null;

  const updateBanner = () => {
    const stale = shownFile !== null && activeFile !== shownFile;
    banner.classList.toggle('hidden', !stale);
    banner.textContent = stale ? `已切換到 ${activeFile ?? '（無編輯器）'}，下方仍是 ${shownFile} 的資訊，按「重新整理」更新。` : '';
  };

  const show = (info: FileInfo | null) => {
    body.textContent = '';
    if (!info) {
      shownFile = null;
      body.append(el('div', 'hint', '沒有開啟中的文字編輯器。'));
      updateBanner();
      return;
    }
    shownFile = info.fileName;
    const p = info.probe;
    const eolDetail = p.eol === '混合' ? `混合（LF ${p.eolCounts.lf}、CRLF ${p.eolCounts.crlf}、CR ${p.eolCounts.cr}）` : p.eol;
    const indentDetail = p.indent === '混合' ? `混合（空白開頭 ${p.indentCounts.spaces} 行、Tab 開頭 ${p.indentCounts.tabs} 行）` : p.indent;

    const root = info.projectRootKind === 'git' ? 'git repo' : '工作區資料夾';
    body.append(
      row(
        el('strong', undefined, info.fileName),
        button('複製絕對路徑', () => ctx.copy(info.path, '絕對路徑'), 'link'),
        info.projectRelativePath !== null && button('複製相對路徑', () => ctx.copy(info.projectRelativePath ?? '', '相對路徑'), 'link', `相對於專案根目錄（${root}）`),
        info.folder !== '' && button('開啟資料夾', () => ctx.post({ type: 'revealInOS', path: info.path }), 'link', '在檔案總管／Finder 顯示這個檔案'),
        el('span', 'hint', `讀取時間 ${new Date(info.readAt).toLocaleString('zh-TW', { hour12: false })}`),
      ),
      card('位置', [
        ['絕對路徑', info.path],
        ['專案根目錄', info.projectRoot && `${info.projectRoot}（${root}）`],
        ['相對路徑', info.projectRelativePath],
        ['工作區相對路徑', info.relativePath !== info.projectRelativePath ? info.relativePath : null],
        ['符號連結目標', info.symlinkTarget],
      ], 'wide'),
    );
    const cards = el('div', 'cards');
    cards.append(
      ...(info.summary
        ? [
            card('摘要', [
              ['在工作區內', info.summary.workspace],
              ['在 git repo 內', info.summary.gitRepo],
              ['git 追蹤', info.summary.gitTracking],
              ['目前使用者權限', info.summary.access],
            ]),
          ]
        : []),
      card('編碼', [
        ['編碼', `${p.encoding}${p.encodingCertain ? '' : '（推測）'}`],
        ['BOM', p.bom ? `有，${p.bom.kind}（${p.bom.bytes} 位元組）` : '無'],
        ['說明', p.encodingNote],
        ['合法 UTF-8', p.validUtf8 ? '是' : '否'],
        ['含 NUL 位元組', p.hasNul ? '是（可能是二進位檔）' : null],
      ]),
      card('內容', [
        ['行數', String(p.lines)],
        ['行尾', eolDetail],
        ['結尾換行', p.endsWithNewline ? '有' : '無'],
        ['縮排', indentDetail],
        ['最長行', p.longestLine.length ? `${p.longestLine.length} 字元（第 ${p.longestLine.line} 行）` : null],
        ['分析範圍', info.truncatedAt ? `只分析前 ${(info.truncatedAt / 1024 / 1024).toFixed(0)} MB` : null],
        ['注意', info.isDirty && !info.isUntitled ? '編輯器有未存檔修改，以上是磁碟上的內容' : null],
      ]),
      card('檔案屬性', [
        ['大小', info.size],
        ['權限', info.mode],
        ['擁有者', info.owner],
        ['群組', info.group],
        ['硬連結數', info.nlink === null ? null : String(info.nlink)],
        ['語言模式', info.languageId],
        ['狀態', info.isUntitled ? '未存檔的新文件' : info.isDirty ? '有未存檔修改' : '已存檔'],
      ]),
      ...(info.times.length ? [card('時間', info.times.map((t) => [t.label, `${t.value}（${t.relative}）`] as [string, string]))] : []),
    );
    body.append(cards);
    updateBanner();
  };

  const refresh = async () => {
    try {
      show(await ctx.call('fileinfo.refresh', null));
    } catch (error) {
      body.textContent = '';
      body.append(el('div', 'error', errorMessage(error)));
    }
  };

  body.append(el('div', 'hint', '按「重新整理」讀取目前檔案的資訊。為避免大檔或網路磁碟拖慢編輯器，切換檔案時不會自動讀取。'));
  root.append(row(button('重新整理', () => void refresh(), 'primary'), el('span', 'hint', '讀取對象：最後一個使用中的文字編輯器')), banner, body);

  return {
    root,
    setActiveFile(name) {
      activeFile = name;
      updateBanner();
    },
    show,
  };
}
