// hash 的輸入解碼與輸出編碼。只把文字編成 UTF-8：Node 沒有內建 Big5／GBK 編碼器，不假裝支援。

export type InputMode = 'text' | 'hex' | 'base64';
export type OutputFormat = 'hex' | 'HEX' | 'base64' | 'base64url';

export function decodeInput(input: string, mode: InputMode): Uint8Array {
  switch (mode) {
    case 'text':
      return new Uint8Array(Buffer.from(input, 'utf8'));
    case 'hex': {
      const compact = input.replace(/0x/gi, '').replace(/[\s:,-]/g, '');
      if (compact.length % 2 !== 0 || /[^0-9a-f]/i.test(compact)) {
        throw new Error('Hex 輸入必須是偶數個 0-9a-f 字元（可含空白、冒號、0x 前綴）');
      }
      return new Uint8Array(Buffer.from(compact, 'hex'));
    }
    case 'base64': {
      const compact = input.replace(/\s/g, '');
      if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(compact)) {
        throw new Error('Base64 輸入含非法字元');
      }
      return new Uint8Array(Buffer.from(compact, compact.includes('-') || compact.includes('_') ? 'base64url' : 'base64'));
    }
  }
}

export function formatBytes(bytes: Uint8Array, format: OutputFormat): string {
  const buffer = Buffer.from(bytes);
  switch (format) {
    case 'hex':
      return buffer.toString('hex');
    case 'HEX':
      return buffer.toString('hex').toUpperCase();
    case 'base64':
      return buffer.toString('base64');
    case 'base64url':
      return buffer.toString('base64url');
  }
}
