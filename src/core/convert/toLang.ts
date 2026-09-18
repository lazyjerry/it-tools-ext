// JSON → 各語言的資料結構：literal 模式照原樣輸出值；struct 模式依推導出的型別產生型別定義。
// 數字一律輸出 JSON 原文，不經 Number()，大整數才不會失真。
import type { JsonNode } from '../json/ast';
import { CASES, goFieldName, splitWords } from '../text/case';
import { collectStructs, inferShape } from './infer';
import type { Field, Shape } from './infer';

export type TargetLanguage = 'php' | 'js' | 'python' | 'go' | 'java' | 'swift' | 'objc';

export type TargetMode =
  | 'php-short'
  | 'php-long'
  | 'php-object'
  | 'js'
  | 'python'
  | 'go-map'
  | 'go-struct'
  | 'java-map'
  | 'java-pojo'
  | 'swift-dict'
  | 'swift-codable'
  | 'objc';

export const TARGET_MODES: { mode: TargetMode; label: string; language: TargetLanguage; vscodeLanguage: string }[] = [
  { mode: 'php-short', label: 'PHP 短陣列 [ ]', language: 'php', vscodeLanguage: 'php' },
  { mode: 'php-long', label: 'PHP array( )', language: 'php', vscodeLanguage: 'php' },
  { mode: 'php-object', label: 'PHP (object) 物件', language: 'php', vscodeLanguage: 'php' },
  { mode: 'js', label: 'JavaScript object literal', language: 'js', vscodeLanguage: 'javascript' },
  { mode: 'python', label: 'Python dict', language: 'python', vscodeLanguage: 'python' },
  { mode: 'go-map', label: 'Go map[string]any', language: 'go', vscodeLanguage: 'go' },
  { mode: 'go-struct', label: 'Go struct + json tag', language: 'go', vscodeLanguage: 'go' },
  { mode: 'java-map', label: 'Java Map.ofEntries / List.of', language: 'java', vscodeLanguage: 'java' },
  { mode: 'java-pojo', label: 'Java POJO + Jackson', language: 'java', vscodeLanguage: 'java' },
  { mode: 'swift-dict', label: 'Swift [String: Any]', language: 'swift', vscodeLanguage: 'swift' },
  { mode: 'swift-codable', label: 'Swift Codable struct', language: 'swift', vscodeLanguage: 'swift' },
  { mode: 'objc', label: 'Objective-C NSDictionary', language: 'objc', vscodeLanguage: 'objective-c' },
];

export interface ConvertOptions {
  indent: string;
  /** 根變數名或根型別名。 */
  rootName?: string;
}

// ── 字串跳脫 ──

function phpString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function jsString(s: string): string {
  // eslint-disable-next-line no-control-regex -- 目的就是找出控制字元並跳脫
  const body = s.replace(/[\\'\n\r\t\u2028\u2029\x00-\x1f]/g, (c) => {
    switch (c) {
      case '\\':
        return '\\\\';
      case "'":
        return "\\'";
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      default:
        return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
    }
  });
  return `'${body}'`;
}

/** Java 編譯前會先展開 \uXXXX（字串裡的 \u000a 會變成真的換行而編譯失敗），控制字元一律用八進位跳脫。 */
function cLikeString(s: string, prefix = ''): string {
  // eslint-disable-next-line no-control-regex -- 目的就是找出控制字元並跳脫
  const body = s.replace(/[\\"\x00-\x1f\x7f]/g, (c) => {
    switch (c) {
      case '\\':
        return '\\\\';
      case '"':
        return '\\"';
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      default:
        return `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`;
    }
  });
  return `${prefix}"${body}"`;
}

function swiftString(s: string): string {
  // eslint-disable-next-line no-control-regex -- 目的就是找出控制字元並跳脫
  const body = s.replace(/[\\"\x00-\x1f\x7f]/g, (c) => {
    switch (c) {
      case '\\':
        return '\\\\';
      case '"':
        return '\\"';
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      default:
        return `\\u{${c.charCodeAt(0).toString(16)}}`;
    }
  });
  return `"${body}"`;
}

const JS_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// ── literal 模式 ──

interface LiteralStyle {
  objOpen: string;
  objClose: string;
  arrOpen: string;
  arrClose: string;
  emptyObj: string;
  emptyArr: string;
  entry: (key: string, value: string) => string;
  str: (s: string) => string;
  num: (raw: string) => string;
  bool: (b: boolean) => string;
  nul: string;
  trailingComma: boolean;
}

function javaNumber(raw: string): string {
  if (!/^-?\d+$/.test(raw)) {
    return raw;
  }
  const value = BigInt(raw);
  if (value <= 2147483647n && value >= -2147483648n) {
    return raw;
  }
  if (value <= 9223372036854775807n && value >= -9223372036854775808n) {
    return `${raw}L`;
  }
  return `new BigInteger("${raw}")`;
}

const STYLES: Partial<Record<TargetMode, LiteralStyle>> = {
  'php-short': {
    objOpen: '[', objClose: ']', arrOpen: '[', arrClose: ']', emptyObj: '[]', emptyArr: '[]',
    entry: (k, v) => `${phpString(k)} => ${v}`, str: phpString, num: (r) => r, bool: String, nul: 'null', trailingComma: true,
  },
  'php-long': {
    objOpen: 'array(', objClose: ')', arrOpen: 'array(', arrClose: ')', emptyObj: 'array()', emptyArr: 'array()',
    entry: (k, v) => `${phpString(k)} => ${v}`, str: phpString, num: (r) => r, bool: String, nul: 'null', trailingComma: true,
  },
  'php-object': {
    objOpen: '(object) [', objClose: ']', arrOpen: '[', arrClose: ']', emptyObj: 'new \\stdClass()', emptyArr: '[]',
    entry: (k, v) => `${phpString(k)} => ${v}`, str: phpString, num: (r) => r, bool: String, nul: 'null', trailingComma: true,
  },
  js: {
    objOpen: '{', objClose: '}', arrOpen: '[', arrClose: ']', emptyObj: '{}', emptyArr: '[]',
    entry: (k, v) => `${JS_IDENT.test(k) ? k : jsString(k)}: ${v}`, str: jsString, num: (r) => r, bool: String, nul: 'null', trailingComma: true,
  },
  python: {
    objOpen: '{', objClose: '}', arrOpen: '[', arrClose: ']', emptyObj: '{}', emptyArr: '[]',
    entry: (k, v) => `${JSON.stringify(k)}: ${v}`, str: (s) => JSON.stringify(s), num: (r) => r,
    bool: (b) => (b ? 'True' : 'False'), nul: 'None', trailingComma: true,
  },
  'go-map': {
    objOpen: 'map[string]any{', objClose: '}', arrOpen: '[]any{', arrClose: '}', emptyObj: 'map[string]any{}', emptyArr: '[]any{}',
    entry: (k, v) => `${JSON.stringify(k)}: ${v}`, str: (s) => JSON.stringify(s), num: (r) => r, bool: String, nul: 'nil', trailingComma: true,
  },
  'java-map': {
    objOpen: 'Map.ofEntries(', objClose: ')', arrOpen: 'List.of(', arrClose: ')', emptyObj: 'Map.of()', emptyArr: 'List.of()',
    entry: (k, v) => `Map.entry(${cLikeString(k)}, ${v})`, str: (s) => cLikeString(s), num: javaNumber, bool: String, nul: 'null', trailingComma: false,
  },
  'swift-dict': {
    objOpen: '[', objClose: ']', arrOpen: '[', arrClose: ']', emptyObj: '[:]', emptyArr: '[]',
    entry: (k, v) => `${swiftString(k)}: ${v}`, str: swiftString, num: (r) => r, bool: String, nul: 'NSNull()', trailingComma: false,
  },
  objc: {
    objOpen: '@{', objClose: '}', arrOpen: '@[', arrClose: ']', emptyObj: '@{}', emptyArr: '@[]',
    entry: (k, v) => `${cLikeString(k, '@')}: ${v}`, str: (s) => cLikeString(s, '@'), num: (r) => `@${r}`,
    bool: (b) => (b ? '@YES' : '@NO'), nul: '[NSNull null]', trailingComma: false,
  },
};

function emitLiteral(node: JsonNode, style: LiteralStyle, indent: string, depth: number): string {
  const pad = indent.repeat(depth + 1);
  const close = indent.repeat(depth);
  const join = (parts: string[], open: string, end: string) =>
    `${open}\n${parts.map((p) => pad + p).join(',\n')}${style.trailingComma ? ',' : ''}\n${close}${end}`;
  switch (node.type) {
    case 'object':
      return node.entries.length === 0
        ? style.emptyObj
        : join(
            node.entries.map((e) => style.entry(e.key, emitLiteral(e.value, style, indent, depth + 1))),
            style.objOpen,
            style.objClose,
          );
    case 'array':
      return node.items.length === 0
        ? style.emptyArr
        : join(node.items.map((i) => emitLiteral(i, style, indent, depth + 1)), style.arrOpen, style.arrClose);
    case 'string':
      return style.str(node.value);
    case 'number':
      return style.num(node.raw);
    case 'boolean':
      return style.bool(node.value);
    case 'null':
      return style.nul;
  }
}

function someNode(node: JsonNode, predicate: (n: JsonNode) => boolean): boolean {
  if (predicate(node)) {
    return true;
  }
  if (node.type === 'object') {
    return node.entries.some((e) => someNode(e.value, predicate));
  }
  if (node.type === 'array') {
    return node.items.some((i) => someNode(i, predicate));
  }
  return false;
}

const hasEmptyObject = (node: JsonNode) => someNode(node, (n) => n.type === 'object' && n.entries.length === 0);
const hasUnsafeInteger = (node: JsonNode) =>
  someNode(node, (n) => n.type === 'number' && /^-?\d+$/.test(n.raw) && !Number.isSafeInteger(Number(n.raw)));

function literalWrapper(mode: TargetMode, name: string, body: string, node: JsonNode): string {
  switch (mode) {
    case 'php-short':
    case 'php-long': {
      const note = hasEmptyObject(node)
        ? '// 注意：空物件 {} 在 PHP 陣列裡與空陣列無法區分，json_encode 會輸出 []；要保留請改用 (object) 模式。\n'
        : '';
      return `${note}$${name} = ${body};\n`;
    }
    case 'php-object':
      return `$${name} = ${body};\n`;
    case 'js': {
      const note = hasUnsafeInteger(node)
        ? '// 注意：部分整數超過 Number.MAX_SAFE_INTEGER，JS 會失去精度；需要精確值請改用字串或 BigInt（加 n 後綴）。\n'
        : '';
      return `${note}const ${name} = ${body};\n`;
    }
    case 'python':
      return `${name} = ${body}\n`;
    case 'go-map':
      return `${name} := ${body}\n`;
    case 'java-map': {
      const notes = someNode(node, (n) => n.type === 'null')
        ? '// 注意：資料含 null，Map.of／List.of 遇到 null 會丟 NullPointerException，請改用 POJO 模式或 HashMap／ArrayList。\n'
        : '';
      const type = node.type === 'array' ? 'List<Object>' : node.type === 'object' ? 'Map<String, Object>' : 'Object';
      return `${notes}${type} ${name} = ${body};\n`;
    }
    case 'swift-dict': {
      const type = node.type === 'array' ? '[Any]' : node.type === 'object' ? '[String: Any]' : 'Any';
      return `let ${name}: ${type} = ${body}\n`;
    }
    case 'objc': {
      const type = node.type === 'array' ? 'NSArray' : node.type === 'object' ? 'NSDictionary' : 'id';
      return `${type} *${name} = ${body};\n`;
    }
    default:
      return body;
  }
}

// ── struct 模式 ──

function camel(key: string): string {
  const name = CASES.camel(splitWords(key));
  return /^[A-Za-z_]/.test(name) ? name : `_${name}`;
}

const JAVA_RESERVED = new Set(['abstract', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while']);
const SWIFT_RESERVED = new Set(['class', 'default', 'func', 'import', 'init', 'let', 'protocol', 'return', 'self', 'static', 'struct', 'var', 'where', 'while', 'case', 'enum', 'extension', 'for', 'if', 'in', 'is', 'switch', 'repeat', 'as', 'do', 'else', 'true', 'false', 'nil', 'operator', 'private', 'public', 'internal', 'subscript', 'super', 'throw', 'try', 'catch', 'defer', 'guard', 'break', 'continue', 'fallthrough', 'type', 'Type', 'Self', 'Protocol']);

type NameOf = (shape: Shape) => string;

function goType(shape: Shape, nameOf: NameOf): string {
  const nullable = 'nullable' in shape && shape.nullable;
  const ptr = (t: string) => (nullable ? `*${t}` : t);
  switch (shape.kind) {
    case 'string':
      return ptr('string');
    case 'int':
      return ptr('int64');
    case 'float':
      return ptr('float64');
    case 'bool':
      return ptr('bool');
    case 'array':
      return `[]${goType(shape.elem, nameOf)}`;
    case 'object':
      return ptr(nameOf(shape));
    default:
      return 'any';
  }
}

function javaType(shape: Shape, nameOf: NameOf): string {
  switch (shape.kind) {
    case 'string':
      return 'String';
    case 'int':
      return shape.big ? 'Long' : 'Integer';
    case 'float':
      return 'Double';
    case 'bool':
      return 'Boolean';
    case 'array':
      return `List<${javaType(shape.elem, nameOf)}>`;
    case 'object':
      return nameOf(shape);
    default:
      return 'Object';
  }
}

function swiftType(shape: Shape, nameOf: NameOf): string {
  const nullable = 'nullable' in shape && shape.nullable;
  const opt = (t: string) => (nullable ? `${t}?` : t);
  switch (shape.kind) {
    case 'string':
      return opt('String');
    case 'int':
      return opt('Int');
    case 'float':
      return opt('Double');
    case 'bool':
      return opt('Bool');
    case 'array':
      return opt(`[${swiftType(shape.elem, nameOf).replace(/\?$/, '')}]`);
    case 'object':
      return opt(nameOf(shape));
    case 'null':
    case 'unknown':
      return 'String? /* 原始資料只有 null 或空陣列，型別待確認 */';
    default:
      return 'AnyCodable? /* 混合型別，需 AnyCodable 套件或自行定義 */';
  }
}

function emitGoStructs(root: Shape, rootName: string, indent: string): string {
  const { structs, names } = collectStructs(root, rootName);
  const nameOf: NameOf = (s) => names.get(s) ?? 'any';
  if (structs.length === 0) {
    return `type ${rootName} ${goType(root, nameOf)}\n`;
  }
  const blocks = structs.map(({ name, fields }) => {
    const lines = fields.map((f: Field) => {
      const tag = `json:"${f.key}${f.optional ? ',omitempty' : ''}"`;
      return `${indent}${goFieldName(f.key)} ${goType(f.shape, nameOf)} \`${tag}\``;
    });
    return `type ${name} struct {\n${lines.join('\n')}\n}`;
  });
  const prefix = root.kind === 'array' ? `// 根節點是陣列：json.Unmarshal 到 []${nameOf((root as { elem: Shape }).elem)}\n\n` : '';
  return prefix + blocks.join('\n\n') + '\n';
}

function emitJavaPojos(root: Shape, rootName: string, indent: string): string {
  const { structs, names } = collectStructs(root, rootName);
  const nameOf: NameOf = (s) => names.get(s) ?? 'Object';
  const header = [
    'import com.fasterxml.jackson.annotation.JsonIgnoreProperties;',
    'import com.fasterxml.jackson.annotation.JsonProperty;',
    'import java.util.List;',
    '',
  ].join('\n');
  const classBody = (fields: Field[], level: number) =>
    fields.map((f) => {
      let field = camel(f.key);
      if (JAVA_RESERVED.has(field)) {
        field += '_';
      }
      const pad = indent.repeat(level);
      return `${pad}@JsonProperty("${f.key}")\n${pad}public ${javaType(f.shape, nameOf)} ${field};`;
    });
  const [first, ...nested] = structs;
  if (!first) {
    return `${header}// 根節點不是物件，沒有可產生的類別\n`;
  }
  const nestedBlocks = nested.map(
    (s) =>
      `${indent}@JsonIgnoreProperties(ignoreUnknown = true)\n${indent}public static class ${s.name} {\n${classBody(s.fields, 2).join('\n\n')}\n${indent}}`,
  );
  const body = [...classBody(first.fields, 1), ...nestedBlocks].join('\n\n');
  const note = root.kind === 'array' ? `// 根節點是陣列：objectMapper.readValue(json, new TypeReference<List<${first.name}>>() {})\n` : '';
  return `${header}\n${note}@JsonIgnoreProperties(ignoreUnknown = true)\npublic class ${first.name} {\n${body}\n}\n`;
}

function emitSwiftCodables(root: Shape, rootName: string, indent: string): string {
  const { structs, names } = collectStructs(root, rootName);
  const nameOf: NameOf = (s) => names.get(s) ?? 'AnyCodable';
  if (structs.length === 0) {
    return `// 根節點不是物件，沒有可產生的型別\n`;
  }
  const blocks = structs.map(({ name, fields }) => {
    const props = fields.map((f) => {
      let prop = camel(f.key);
      if (SWIFT_RESERVED.has(prop)) {
        prop = `\`${prop}\``;
      }
      let type = swiftType(f.shape, nameOf);
      if (f.optional && !type.includes('?')) {
        type += '?';
      }
      return { prop, key: f.key, line: `${indent}let ${prop}: ${type}` };
    });
    const needsKeys = props.some((p) => p.prop.replace(/`/g, '') !== p.key);
    const keys = needsKeys
      ? `\n\n${indent}enum CodingKeys: String, CodingKey {\n${props
          .map((p) => `${indent}${indent}case ${p.prop}${p.prop.replace(/`/g, '') === p.key ? '' : ` = ${swiftString(p.key)}`}`)
          .join('\n')}\n${indent}}`
      : '';
    return `struct ${name}: Codable {\n${props.map((p) => p.line).join('\n')}${keys}\n}`;
  });
  const note = root.kind === 'array' ? `// 根節點是陣列：JSONDecoder().decode([${structs[0].name}].self, from: data)\n\n` : '';
  return note + blocks.join('\n\n') + '\n';
}

export function convertJson(node: JsonNode, mode: TargetMode, options: ConvertOptions): string {
  const indent = options.indent || '    ';
  const style = STYLES[mode];
  if (style) {
    return literalWrapper(mode, options.rootName ?? 'data', emitLiteral(node, style, indent, 0), node);
  }
  const rootName = options.rootName && /^[A-Z]/.test(options.rootName) ? options.rootName : 'Root';
  const shape = inferShape(node);
  switch (mode) {
    case 'go-struct':
      return emitGoStructs(shape, rootName, '\t');
    case 'java-pojo':
      return emitJavaPojos(shape, rootName, indent);
    case 'swift-codable':
      return emitSwiftCodables(shape, rootName, indent);
    default:
      throw new Error(`不支援的轉換模式：${mode}`);
  }
}
