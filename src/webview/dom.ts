// 零框架的 DOM 小工具。所有文字一律走 textContent：使用者貼進來的內容可能含任何字元，不能拼進 innerHTML。

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export function button(label: string, onClick: () => void, variant: 'primary' | 'secondary' | 'link' = 'secondary', title?: string): HTMLButtonElement {
  const node = el('button', variant, label);
  node.type = 'button';
  if (title) {
    node.title = title;
  }
  node.addEventListener('click', onClick);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// 自繪 16×16 線條圖示：不帶圖示字型，維持零依賴，也不必為字型放寬 CSP。
const ICONS = {
  format: ['M2 3h8', 'M5 6.3h9', 'M5 9.7h9', 'M2 13h8'],
  minify: ['M1.5 8H6', 'M4 5.5 6.5 8 4 10.5', 'M14.5 8H10', 'M12 5.5 9.5 8 12 10.5'],
  sort: ['M2 4h7', 'M2 8h5', 'M2 12h3', 'M12 3v10', 'M9.5 10.5 12 13l2.5-2.5'],
  unescape: ['M3 2.5l5 11', 'M10 6l4 4', 'M14 6l-4 4'],
  stats: ['M2 13.5h12', 'M4 13V8.5', 'M8 13V3', 'M12 13V6.5'],
  settings: ['M2 4h6.5', 'M11.5 4H14', 'M2 8h1.5', 'M6.5 8H14', 'M2 12h7.5', 'M12.5 12H14', 'M10 2.5v3', 'M5 6.5v3', 'M11 10.5v3'],
} as const;

export type IconName = keyof typeof ICONS;

/** 只有圖示的按鈕；名稱（與選填的說明）放在 hover 提示，同時給螢幕閱讀器當標籤。 */
export function iconButton(icon: IconName, label: string, onClick: () => void, variant: 'primary' | 'secondary' = 'secondary', description?: string): HTMLButtonElement {
  const node = el('button', `${variant} icon`);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.dataset.tip = description ? `${label}\n${description}` : label;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[icon]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  node.append(svg);
  node.addEventListener('click', onClick);
  return node;
}

function helpMark(help: string): HTMLSpanElement {
  const mark = el('span', 'help', '?');
  mark.tabIndex = 0;
  mark.dataset.tip = help;
  mark.setAttribute('aria-label', help);
  // 標記放在 <label> 裡：不擋下點擊的話，點 ? 會連帶切換核取方塊
  mark.addEventListener('click', (event) => event.preventDefault());
  // 提示預設往右展開；標記靠近面板右緣時改成往左，否則會被裁掉。320 = styles.css 的 max-width 300 加上 padding 與邊框
  const place = () => mark.classList.toggle('tip-left', mark.getBoundingClientRect().left + 320 > window.innerWidth);
  mark.addEventListener('mouseenter', place);
  mark.addEventListener('focus', place);
  return mark;
}

export function field(label: string, control: HTMLElement, className = 'field', help?: string): HTMLLabelElement {
  const wrapper = el('label', className);
  const caption = el('span', 'field-label', label);
  if (help) {
    caption.append(helpMark(help));
  }
  wrapper.append(caption, control);
  return wrapper;
}

export function select(options: { value: string; label: string }[], value: string, onChange: (value: string) => void): HTMLSelectElement {
  const node = el('select');
  for (const option of options) {
    const item = el('option', undefined, option.label);
    item.value = option.value;
    node.append(item);
  }
  node.value = options.some((o) => o.value === value) ? value : (options[0]?.value ?? '');
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

export function checkbox(label: string, checked: boolean, onChange: (checked: boolean) => void, help?: string): HTMLLabelElement {
  const wrapper = el('label', 'checkbox');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  wrapper.append(input, el('span', undefined, label));
  if (help) {
    wrapper.append(helpMark(help));
  }
  return wrapper;
}

export function row(...children: (HTMLElement | null | undefined | false)[]): HTMLDivElement {
  const node = el('div', 'row');
  node.append(...children.filter((c): c is HTMLElement => Boolean(c)));
  return node;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** 結果區：成功顯示文字、失敗顯示紅字，兩者共用同一個位置。 */
export interface Output {
  root: HTMLElement;
  value(): string;
  set(text: string): void;
  error(message: string): void;
  clear(): void;
}

export function outputBox(placeholder = '結果會顯示在這裡'): Output {
  const root = el('div', 'output');
  const area = el('textarea', 'mono');
  area.readOnly = true;
  area.placeholder = placeholder;
  const error = el('div', 'error hidden');
  root.append(area, error);
  let current = '';
  return {
    root,
    value: () => current,
    set(text) {
      current = text;
      area.value = text;
      area.classList.remove('hidden');
      error.classList.add('hidden');
    },
    error(message) {
      current = '';
      error.textContent = message;
      error.classList.remove('hidden');
      area.classList.add('hidden');
    },
    clear() {
      current = '';
      area.value = '';
      area.classList.remove('hidden');
      error.classList.add('hidden');
    },
  };
}

/** 左右兩欄（窄面板時自動上下堆疊）。 */
export function columns(...children: HTMLElement[]): HTMLDivElement {
  const node = el('div', 'cols');
  for (const child of children) {
    const col = el('div', 'col');
    col.append(child);
    node.append(col);
  }
  return node;
}
