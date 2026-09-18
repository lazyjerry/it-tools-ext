// 密碼檢查與密碼產生兩個分頁共用的規則：一份 store、各自一組控制項，任一邊改動另一邊跟著變。
// 規則不是 secret，寫進面板狀態跨隱藏保留；設定頁的值只當預設值，面板上的改動不寫回設定。
import type { PasswordPolicy } from '../../core/password/policy';
import { button, checkbox, el, field, row } from '../dom';
import type { TabContext } from '../context';

const STATE_KEY = 'password.policy';

export class PolicyStore {
  private readonly listeners: (() => void)[] = [];
  private current: PasswordPolicy;

  constructor(private readonly ctx: TabContext) {
    this.current = this.load();
  }

  get policy(): PasswordPolicy {
    return this.current;
  }

  private load(): PasswordPolicy {
    try {
      const saved: unknown = JSON.parse(this.ctx.get(STATE_KEY, 'null'));
      if (saved && typeof saved === 'object') {
        return { ...this.ctx.init.policy, ...(saved as Partial<PasswordPolicy>) };
      }
    } catch {
      // 狀態壞掉就當沒自訂過
    }
    return { ...this.ctx.init.policy };
  }

  update(patch: Partial<PasswordPolicy>): void {
    this.current = { ...this.current, ...patch };
    this.ctx.set(STATE_KEY, JSON.stringify(this.current));
    this.emit();
  }

  reset(): void {
    this.current = { ...this.ctx.init.policy };
    this.ctx.set(STATE_KEY, '');
    this.emit();
  }

  /** 設定頁的預設值變了：面板上沒自訂過才跟著換，自訂過的留給使用者按「還原預設」。 */
  defaultsChanged(): void {
    if (this.ctx.get(STATE_KEY) === '') {
      this.current = { ...this.ctx.init.policy };
      this.emit();
    }
  }

  subscribe(listener: () => void): void {
    this.listeners.push(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

type Flag = { [K in keyof PasswordPolicy]: PasswordPolicy[K] extends boolean ? K : never }[keyof PasswordPolicy];

const REQUIRE: { key: Flag; label: string }[] = [
  { key: 'requireUppercase', label: '大寫' },
  { key: 'requireLowercase', label: '小寫' },
  { key: 'requireDigit', label: '數字' },
  { key: 'requireSymbol', label: '符號' },
];

const FORBID: { key: Flag; label: string }[] = [
  { key: 'forbidSequential', label: '禁連續字元（abc、321）' },
  { key: 'forbidRepeated', label: '禁重複字元（aaa）' },
  { key: 'forbidKeyboard', label: '禁鍵盤序列（qwer、asdf）' },
  { key: 'forbidCommon', label: '禁常見弱密碼（Top 1000）' },
];

export function policyPanel(ctx: TabContext, store: PolicyStore): HTMLElement {
  const root = el('div', 'policy-panel');

  const minLength = el('input');
  minLength.type = 'number';
  minLength.min = '1';
  minLength.max = '256';
  minLength.addEventListener('input', () => {
    const value = Math.floor(Number(minLength.value));
    if (value >= 1) {
      store.update({ minLength: Math.min(value, 256) });
    }
  });

  const symbolSet = el('input', 'mono');
  symbolSet.type = 'text';
  symbolSet.spellcheck = false;
  symbolSet.addEventListener('input', () => store.update({ symbolSet: symbolSet.value || ctx.init.policy.symbolSet }));

  const flags = new Map<Flag, HTMLInputElement>();
  const flag = ({ key, label }: { key: Flag; label: string }) => {
    const wrapper = checkbox(label, store.policy[key], (checked) => store.update({ [key]: checked }));
    flags.set(key, wrapper.querySelector('input') as HTMLInputElement);
    return wrapper;
  };

  const render = () => {
    const policy = store.policy;
    // 正在輸入的欄位不回填，否則清空重打時會被立刻塞回舊值
    if (document.activeElement !== minLength) {
      minLength.value = String(policy.minLength);
    }
    if (document.activeElement !== symbolSet) {
      symbolSet.value = policy.symbolSet;
    }
    symbolSet.placeholder = ctx.init.policy.symbolSet;
    for (const [key, input] of flags) {
      input.checked = policy[key];
    }
  };

  root.append(
    el('h3', undefined, '規則'),
    row(field('最小長度', minLength), ...REQUIRE.map(flag), field('符號集', symbolSet, 'field grow', '算作特殊符號的字元，產生密碼時也從這裡取。清空則用預設值。')),
    row(
      ...FORBID.map(flag),
      button('還原預設', () => store.reset(), 'secondary', '回到設定頁 itTools.password 的值'),
      button('修改預設值', () => ctx.post({ type: 'openSettings', query: 'itTools.password' }), 'link'),
    ),
  );
  store.subscribe(render);
  render();
  return root;
}
