import * as assert from 'node:assert/strict';

import { toolInfos } from '../../src/core/registry';

suite('工具清單', () => {
  test('有專屬分頁的工具不出現在面板的常用工具，但指令清單仍保留', () => {
    const all = toolInfos();
    const panel = all.filter((t) => !t.hasTab);
    assert.deepEqual([...new Set(panel.map((t) => t.group))], ['編碼', '文字', '產生']);
    for (const id of ['hash.report', 'json.format', 'convert.jsonTo', 'php.serialize', 'jwt.decode', 'time.timestamp', 'password.check']) {
      assert.ok(all.some((t) => t.id === id), `${id} 應留在指令清單`);
      assert.ok(!panel.some((t) => t.id === id), `${id} 不該出現在常用工具分頁`);
    }
  });
});
