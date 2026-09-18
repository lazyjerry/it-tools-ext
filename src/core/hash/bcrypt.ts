// bcrypt 雜湊字串結構解析。只拆欄位、講相容性，不產生也不驗證（零依賴下不自實作 Blowfish）。

export interface BcryptInfo {
  version: string;
  cost: number;
  iterations: number;
  salt: string;
  hash: string;
  notes: string[];
}

const VERSION_NOTES: Record<string, string> = {
  '2y': 'PHP password_hash() 的預設前綴（PHP 5.3.7 起修正 8 位元字元處理）。部分舊版 Java 函式庫（jBCrypt 0.4 以前）不認 $2y$，需先把前綴改成 $2a$ 再驗證，雜湊本體相同',
  '2a': 'jBCrypt／Spring Security 預設前綴。PHP password_verify() 可直接驗證',
  '2b': 'OpenBSD 2014 年修正長度溢位後的前綴，Node bcrypt／Python bcrypt 預設。PHP password_verify() 可直接驗證',
  '2x': 'PHP 用來標示舊版有 8 位元字元缺陷的雜湊，只為相容舊資料，不應再產生',
};

export function parseBcrypt(input: string): BcryptInfo {
  const match = /^\$(2[abxy]?)\$(\d{2})\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/.exec(input.trim());
  if (!match) {
    throw new Error('不是 bcrypt 格式：應為 $2y$10$ 開頭、總長 60 字元');
  }
  const [, version, costText, salt, hash] = match;
  const cost = Number(costText);
  const notes = [VERSION_NOTES[version] ?? `$${version}$ 是最早期的前綴，現行實作多半不再產生`];
  notes.push('bcrypt 只取密碼前 72 個位元組，超過的部分不影響結果');
  if (cost < 10) {
    notes.push(`cost ${cost} 偏低，PHP 預設為 10（PHP 8.4 起為 12）`);
  }
  return { version: `$${version}$`, cost, iterations: 2 ** cost, salt, hash, notes };
}
