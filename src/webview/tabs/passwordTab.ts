// 密碼檢查、密碼產生兩個分頁：規則共用同一份 PolicyStore。輸入的密碼不寫進面板狀態，隱藏面板就清掉。
import { button, checkbox, debounce, el, field, row } from '../dom';
import type { RuleSnippet } from '../../core/password/codegen';
import type { TabContext } from '../context';
import { errorMessage } from '../context';
import { policyPanel } from './passwordPolicy';
import type { PolicyStore } from './passwordPolicy';

export function passwordCheckTab(ctx: TabContext, store: PolicyStore): HTMLElement {
  const root = el('div', 'tab');

  const secret = el('input');
  secret.type = 'password';
  secret.placeholder = '輸入要檢查的密碼（不會被儲存）';
  secret.autocomplete = 'off';
  const checkResult = el('div', 'rules');
  const check = debounce(async () => {
    checkResult.textContent = '';
    if (secret.value === '') {
      return;
    }
    try {
      const result = await ctx.call('password.check', { password: secret.value, policy: store.policy });
      for (const rule of result.rules) {
        checkResult.append(el('div', rule.passed ? 'rule pass' : 'rule fail', `${rule.passed ? '✓' : '✗'} ${rule.label}${rule.detail ? `（${rule.detail}）` : ''}`));
      }
      const meter = el('div', 'meter');
      const bar = el('div', `bar strength-${result.strength}`);
      bar.style.width = `${Math.min(100, (result.entropyBits / 128) * 100)}%`;
      meter.append(bar);
      checkResult.append(
        meter,
        el('div', 'hint', `熵值估算 ${result.entropyBits.toFixed(1)} bits（${result.strength}）${result.passed ? '・全部規則通過' : ''}。以字元集 × 長度估算，有規律的密碼實際更弱。`),
      );
    } catch (error) {
      checkResult.append(el('div', 'error', errorMessage(error)));
    }
  }, 150);
  secret.addEventListener('input', () => check());

  // 等價的驗證程式碼：語言頁籤 + 單一顯示區，一次只看一種
  const snippetBar = el('div', 'subtabs');
  snippetBar.setAttribute('role', 'tablist');
  const snippetCode = el('pre', 'mono code');
  let snippets: RuleSnippet[] = [];
  const showSnippet = (id: string) => {
    const active = snippets.find((s) => s.id === id) ?? snippets[0];
    snippetCode.textContent = active?.code ?? '';
    for (const node of snippetBar.children) {
      const selected = (node as HTMLElement).dataset.id === active?.id;
      node.classList.toggle('active', selected);
      node.setAttribute('aria-selected', String(selected));
    }
  };
  const refreshSnippets = async () => {
    try {
      snippets = await ctx.call('password.snippets', { policy: store.policy });
    } catch (error) {
      snippets = [];
      snippetCode.textContent = errorMessage(error);
      return;
    }
    if (snippetBar.childElementCount === 0) {
      for (const { id, label } of snippets) {
        const tab = el('button', 'subtab', label);
        tab.type = 'button';
        tab.dataset.id = id;
        tab.setAttribute('role', 'tab');
        tab.addEventListener('click', () => {
          ctx.set('password.snippet', id);
          showSnippet(id);
        });
        snippetBar.append(tab);
      }
    }
    showSnippet(ctx.get('password.snippet'));
  };

  const reveal = checkbox('顯示', false, (v) => {
    secret.type = v ? 'text' : 'password';
  });

  root.append(
    policyPanel(ctx, store),
    el('h3', undefined, '檢查'),
    row(field('密碼', secret, 'field grow'), reveal),
    checkResult,
    el('h3', undefined, '驗證程式碼'),
    snippetBar,
    // 程式碼可能上百行，複製鈕放在上面才不用捲到底
    row(button('複製程式碼', () => ctx.copy(snippetCode.textContent ?? '', '驗證程式碼'))),
    snippetCode,
    el('div', 'hint', '程式碼跟著上方規則即時更新，判定方式與這裡的檢查相同；常見弱密碼清單（Top 1000）不隨程式碼輸出，需自備。'),
  );
  store.subscribe(() => {
    void refreshSnippets();
    check();
  });
  void refreshSnippets();
  return root;
}

export function passwordGenerateTab(ctx: TabContext, store: PolicyStore): { root: HTMLElement; onDefaultsChanged(): void } {
  const root = el('div', 'tab');

  const length = el('input');
  length.type = 'number';
  length.min = '4';
  length.max = '256';
  length.value = String(ctx.init.generateLength);
  const count = ctx.input('password.count', 'number', '5');
  count.min = '1';
  count.max = '50';
  let exclude = ctx.init.excludeAmbiguous;
  const generated = el('div', 'generated');
  const generate = async () => {
    generated.textContent = '';
    try {
      const list = await ctx.call('password.generate', { length: Number(length.value) || 16, count: Number(count.value) || 1, excludeAmbiguous: exclude, policy: store.policy });
      for (const pw of list) {
        const item = el('div', 'generated-item');
        item.append(el('code', 'mono', pw), button('複製', () => ctx.copy(pw, '密碼'), 'link'));
        generated.append(item);
      }
    } catch (error) {
      generated.append(el('div', 'error', errorMessage(error)));
    }
  };

  root.append(
    policyPanel(ctx, store),
    el('h3', undefined, '產生'),
    row(
      field('長度', length),
      field('數量', count),
      checkbox('排除易混淆字元（0 O 1 l I）', exclude, (v) => {
        exclude = v;
      }),
      button('產生', () => void generate(), 'primary'),
    ),
    generated,
  );

  return {
    root,
    onDefaultsChanged: () => {
      length.value = String(ctx.init.generateLength);
    },
  };
}
