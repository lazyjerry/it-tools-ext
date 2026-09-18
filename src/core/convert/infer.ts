// 從 JSON 推導型別，給 Go struct／Java POJO／Swift Codable 用。陣列裡的物件會合併欄位，缺席的欄位標 optional。
import type { JsonNode } from '../json/ast';

export type Shape =
  | { kind: 'string'; nullable?: boolean }
  | { kind: 'int'; nullable?: boolean; /** 超出 32 位元有號範圍 */ big?: boolean }
  | { kind: 'float'; nullable?: boolean }
  | { kind: 'bool'; nullable?: boolean }
  | { kind: 'null' }
  | { kind: 'any'; nullable?: boolean }
  | { kind: 'unknown' }
  | { kind: 'array'; elem: Shape; nullable?: boolean }
  | { kind: 'object'; fields: Field[]; nullable?: boolean };

export interface Field {
  key: string;
  shape: Shape;
  /** 陣列中部分物件沒有這個欄位。 */
  optional: boolean;
}

const INT32_MAX = 2147483647n;

export function inferShape(node: JsonNode): Shape {
  switch (node.type) {
    case 'string':
      return { kind: 'string' };
    case 'boolean':
      return { kind: 'bool' };
    case 'null':
      return { kind: 'null' };
    case 'number': {
      if (!/^-?\d+$/.test(node.raw)) {
        return { kind: 'float' };
      }
      const value = BigInt(node.raw);
      return { kind: 'int', big: value > INT32_MAX || value < -INT32_MAX - 1n };
    }
    case 'array':
      return { kind: 'array', elem: node.items.map(inferShape).reduce(mergeShapes, { kind: 'unknown' } as Shape) };
    case 'object':
      return { kind: 'object', fields: node.entries.map((e) => ({ key: e.key, shape: inferShape(e.value), optional: false })) };
  }
}

function isNullable(shape: Shape): boolean {
  return 'nullable' in shape && shape.nullable === true;
}

function withNullable(shape: Shape): Shape {
  if (shape.kind === 'null' || shape.kind === 'unknown') {
    return shape;
  }
  return { ...shape, nullable: true };
}

export function mergeShapes(a: Shape, b: Shape): Shape {
  if (a.kind === 'unknown') {
    return b;
  }
  if (b.kind === 'unknown') {
    return a;
  }
  if (a.kind === 'null') {
    return b.kind === 'null' ? a : withNullable(b);
  }
  if (b.kind === 'null') {
    return withNullable(a);
  }
  const nullable = isNullable(a) || isNullable(b);
  const finish = (shape: Shape) => (nullable ? withNullable(shape) : shape);

  if (a.kind === 'int' && b.kind === 'int') {
    return finish({ kind: 'int', big: a.big || b.big });
  }
  if ((a.kind === 'int' || a.kind === 'float') && (b.kind === 'int' || b.kind === 'float')) {
    return finish({ kind: 'float' });
  }
  if (a.kind === 'array' && b.kind === 'array') {
    return finish({ kind: 'array', elem: mergeShapes(a.elem, b.elem) });
  }
  if (a.kind === 'object' && b.kind === 'object') {
    return finish({ kind: 'object', fields: mergeFields(a.fields, b.fields) });
  }
  if (a.kind === b.kind) {
    return finish({ kind: a.kind } as Shape);
  }
  return finish({ kind: 'any' });
}

function mergeFields(a: Field[], b: Field[]): Field[] {
  const result = a.map((field) => {
    const other = b.find((f) => f.key === field.key);
    return other
      ? { key: field.key, shape: mergeShapes(field.shape, other.shape), optional: field.optional || other.optional }
      : { ...field, optional: true };
  });
  for (const field of b) {
    if (!a.some((f) => f.key === field.key)) {
      result.push({ ...field, optional: true });
    }
  }
  return result;
}

export interface NamedStruct {
  name: string;
  fields: Field[];
}

/** 把巢狀物件攤平成具名型別清單，根在第一個；欄位名轉型別名時做簡單單數化（items → Item）。 */
export function collectStructs(root: Shape, rootName: string): { structs: NamedStruct[]; names: Map<Shape, string> } {
  const structs: NamedStruct[] = [];
  const names = new Map<Shape, string>();
  const used = new Set<string>();

  const unique = (base: string) => {
    let name = base || 'Item';
    for (let i = 2; used.has(name); i += 1) {
      name = `${base}${i}`;
    }
    used.add(name);
    return name;
  };

  const visit = (shape: Shape, suggested: string) => {
    if (shape.kind === 'array') {
      visit(shape.elem, singular(suggested));
    } else if (shape.kind === 'object') {
      const name = unique(suggested);
      names.set(shape, name);
      structs.push({ name, fields: shape.fields });
      for (const field of shape.fields) {
        visit(field.shape, pascal(field.key));
      }
    }
  };
  visit(root, rootName);
  return { structs, names };
}

function pascal(key: string): string {
  const name = key
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return /^[A-Za-z]/.test(name) ? name : `T${name}`;
}

function singular(name: string): string {
  if (/ies$/.test(name) && name.length > 4) {
    return name.slice(0, -3) + 'y';
  }
  if (/[^s]s$/.test(name) && name.length > 3) {
    return name.slice(0, -1);
  }
  return `${name}Item`;
}
