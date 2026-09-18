// JWT 分頁：輸入變動即解碼。token 本身就是憑證，與密鑰一樣不寫進面板狀態，隱藏面板就清掉。
import { button, columns, debounce, el, field, outputBox, row } from '../dom';
import type { TabContext } from '../context';
import { errorMessage } from '../context';

export function jwtTab(ctx: TabContext): HTMLElement {
  const root = el('div', 'tab report');
  const output = outputBox('解碼結果會顯示在這裡');
  const secret = el('input');
  secret.type = 'password';
  secret.placeholder = '留空只解碼，不驗簽';
  secret.autocomplete = 'off';

  const decode = debounce(async () => {
    if (token.value.trim() === '') {
      output.clear();
      return;
    }
    try {
      output.set(await ctx.call('tool.run', { toolId: 'jwt.decode', input: token.value, params: { secret: secret.value } }));
    } catch (error) {
      output.error(errorMessage(error));
    }
  }, 200);
  const token = el('textarea', 'mono');
  token.placeholder = '貼上 JWT（可含 Bearer 前綴）';
  token.spellcheck = false;
  token.addEventListener('input', () => decode());
  // 0.1.1 以前會把 token 寫進狀態，清掉留下的那份
  if (ctx.get('jwt.token') !== '') {
    ctx.set('jwt.token', '');
  }
  secret.addEventListener('input', () => decode());

  root.append(
    row(field('HS256／384／512 密鑰', secret, 'field grow', '只支援 HMAC 系列的驗簽；RS／ES／PS 需要公鑰，這裡只解碼不驗。密鑰與 JWT 都不會被儲存。')),
    columns(token, output.root),
    row(
      button('複製結果', () => ctx.copy(output.value(), '結果')),
      button('開在編輯器', () => ctx.openInEditor(output.value(), 'markdown')),
    ),
  );
  decode();
  return root;
}
