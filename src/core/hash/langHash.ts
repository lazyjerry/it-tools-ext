// 各語言「看起來是同一個 hash、實際輸出不同」的變體。

/** Java String.hashCode()：以 UTF-16 code unit 計算 s[0]*31^(n-1) + ...，溢位回繞成 32 位元有號整數。 */
export function javaStringHashCode(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return h;
}

/** Java 常見寫法 `Integer.toHexString(b & 0xff)` 不補零：位元組 < 0x10 只輸出一個字元。 */
export function javaToHexStringNoPad(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16)).join('');
}

/** Java `new BigInteger(1, digest).toString(16)`：數值轉字串會吃掉開頭的 0。 */
export function javaBigIntegerHex(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex').replace(/^0+/, '');
  return hex === '' ? '0' : hex;
}

export function toSigned32(value: number): number {
  return value | 0;
}
