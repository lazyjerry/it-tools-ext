// 設定讀取。每次呼叫都即時讀，使用者改設定不需重新載入。
import * as vscode from 'vscode';

import { indentUnit } from './core/json/ast';
import type { Indent } from './core/json/ast';
import { DEFAULT_POLICY, GENERATE_LENGTH_RANGE, clampInt, safeMinLength } from './core/password/policy';
import type { PasswordPolicy } from './core/password/policy';

function section(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('itTools');
}

export function indent(): string {
  return indentUnit(section().get<Indent>('json.indent', '2'));
}

export function inPlaceEdit(): boolean {
  return section().get<boolean>('inPlaceEdit', true);
}

export function passwordPolicy(): PasswordPolicy {
  const c = section();
  const get = <K extends keyof PasswordPolicy>(key: K) => c.get<PasswordPolicy[K]>(`password.${key}`, DEFAULT_POLICY[key]);
  return {
    minLength: safeMinLength(get('minLength')),
    requireUppercase: get('requireUppercase'),
    requireLowercase: get('requireLowercase'),
    requireDigit: get('requireDigit'),
    requireSymbol: get('requireSymbol'),
    symbolSet: get('symbolSet') || DEFAULT_POLICY.symbolSet,
    forbidSequential: get('forbidSequential'),
    forbidRepeated: get('forbidRepeated'),
    forbidKeyboard: get('forbidKeyboard'),
    forbidCommon: get('forbidCommon'),
  };
}

export function generateLength(): number {
  return clampInt(section().get<unknown>('password.generateLength'), GENERATE_LENGTH_RANGE.min, GENERATE_LENGTH_RANGE.max, GENERATE_LENGTH_RANGE.fallback);
}

export function excludeAmbiguous(): boolean {
  return section().get<boolean>('password.excludeAmbiguous', false);
}

export function resolveOwnerName(): boolean {
  return section().get<boolean>('fileInfo.resolveOwnerName', true);
}
