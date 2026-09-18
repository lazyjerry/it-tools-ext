// 把密碼規則輸出成各語言／框架的驗證程式碼。判定語意以 policy.ts 的 checkPassword 為準：
// 長度算 code point、大小寫與數字只認 ASCII、符號只認符號集；scripts/verify-password-rules.mjs 以實際執行做差分比對。
import { laravelRule } from './policy';
import type { PasswordPolicy } from './policy';

export interface RuleSnippet {
  id: string;
  label: string;
  code: string;
}

/** 輸出程式碼裡的錯誤訊息；驗證腳本也靠它把訊息對回規則。 */
export function ruleMessages(policy: PasswordPolicy) {
  return {
    length: `至少 ${policy.minLength} 個字元`,
    upper: '需包含大寫英文',
    lower: '需包含小寫英文',
    digit: '需包含數字',
    symbol: '需包含特殊符號',
    sequential: '不可含 3 個以上連續字元（abc、321）',
    repeated: '不可含同一字元連續 3 次以上',
    keyboard: '不可含 4 碼以上鍵盤序列（qwer、asdf）',
  };
}

const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const COMMON_NOTE = '常見弱密碼：清單不隨程式碼輸出，需自備（例如 SecLists Top 1000），比對前先轉小寫';

type Line = string | false | null | undefined;

function lines(...parts: (Line | Line[])[]): string {
  return parts.flat().filter((l): l is string => typeof l === 'string').join('\n') + '\n';
}

function indentBlock(block: Line[], prefix: string): Line[] {
  return block.map((l) => (typeof l === 'string' && l !== '' ? prefix + l : l));
}

const single = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const double = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const kotlinString = (s: string) => double(s).replace(/\$/g, '\\$');

function needsLower(policy: PasswordPolicy): boolean {
  return policy.forbidSequential || policy.forbidKeyboard;
}

// ── PHP（CI3、CI4 共用本體） ──

function phpBody(policy: PasswordPolicy): Line[] {
  const m = ruleMessages(policy);
  return [
    '$errors = [];',
    "$chars = preg_split('//u', $pw, -1, PREG_SPLIT_NO_EMPTY) ?: [];",
    needsLower(policy) && '$lower = strtolower($pw);',
    `if (count($chars) < ${policy.minLength}) {`,
    `    $errors[] = ${single(m.length)};`,
    '}',
    ...(policy.requireUppercase ? ["if (!preg_match('/[A-Z]/', $pw)) {", `    $errors[] = ${single(m.upper)};`, '}'] : []),
    ...(policy.requireLowercase ? ["if (!preg_match('/[a-z]/', $pw)) {", `    $errors[] = ${single(m.lower)};`, '}'] : []),
    ...(policy.requireDigit ? ["if (!preg_match('/[0-9]/', $pw)) {", `    $errors[] = ${single(m.digit)};`, '}'] : []),
    ...(policy.requireSymbol
      ? [
          `$symbols = preg_split('//u', ${single(policy.symbolSet)}, -1, PREG_SPLIT_NO_EMPTY);`,
          'if (!array_intersect($chars, $symbols)) {',
          `    $errors[] = ${single(m.symbol)};`,
          '}',
        ]
      : []),
    ...(policy.forbidSequential
      ? [
          'for ($i = 0; $i + 3 <= strlen($lower); $i++) {',
          '    $chunk = substr($lower, $i, 3);',
          '    $step = ord($chunk[1]) - ord($chunk[0]);',
          "    if (preg_match('/^[a-z0-9]{3}$/', $chunk) && abs($step) === 1 && ord($chunk[2]) - ord($chunk[1]) === $step) {",
          `        $errors[] = ${single(m.sequential)};`,
          '        break;',
          '    }',
          '}',
        ]
      : []),
    ...(policy.forbidRepeated ? ["if (preg_match('/(.)\\1{2,}/u', $pw)) {", `    $errors[] = ${single(m.repeated)};`, '}'] : []),
    ...(policy.forbidKeyboard
      ? [
          `foreach ([${ROWS.map(single).join(', ')}] as $row) {`,
          '    foreach ([$row, strrev($row)] as $line) {',
          '        for ($i = 0; $i + 4 <= strlen($line); $i++) {',
          '            if (strpos($lower, substr($line, $i, 4)) !== false) {',
          `                $errors[] = ${single(m.keyboard)};`,
          '                break 3;',
          '            }',
          '        }',
          '    }',
          '}',
        ]
      : []),
    policy.forbidCommon && `// ${COMMON_NOTE}`,
    'return $errors;',
  ];
}

function ci3(policy: PasswordPolicy): string {
  return lines(
    '// application/helpers/password_helper.php',
    'function password_policy_errors($pw)',
    '{',
    indentBlock(phpBody(policy), '    '),
    '}',
    '',
    "// Controller：$this->load->helper('password'); $this->load->library('form_validation');",
    "$this->form_validation->set_rules('password', '密碼', [",
    "    'required',",
    "    ['password_policy', function ($pw) {",
    '        $errors = password_policy_errors((string) $pw);',
    "        $this->form_validation->set_message('password_policy', implode('、', $errors));",
    '        return !$errors;',
    '    }],',
    ']);',
  );
}

function ci4(policy: PasswordPolicy): string {
  return lines(
    '<?php',
    '// app/Validation/PasswordRules.php',
    'namespace App\\Validation;',
    '',
    'class PasswordRules',
    '{',
    '    public function password_policy(?string $pw, ?string &$error = null): bool',
    '    {',
    "        $errors = $this->errors($pw ?? '');",
    "        $error = $errors ? implode('、', $errors) : null;",
    '        return !$errors;',
    '    }',
    '',
    '    private function errors(string $pw): array',
    '    {',
    indentBlock(phpBody(policy), '        '),
    '    }',
    '}',
    '',
    '// app/Config/Validation.php：$ruleSets 加上 \\App\\Validation\\PasswordRules::class',
    "// 使用：$this->validate(['password' => 'required|password_policy']);",
  );
}

// ── Python ──

function python(policy: PasswordPolicy): string {
  const m = ruleMessages(policy);
  return lines(
    'import re',
    '',
    policy.requireSymbol && `SYMBOLS = ${double(policy.symbolSet)}`,
    policy.forbidKeyboard && `KEYBOARD_ROWS = (${ROWS.map(double).join(', ')})`,
    (policy.requireSymbol || policy.forbidKeyboard) && '',
    ...(policy.forbidSequential
      ? [
          '',
          'def _has_sequential(lower: str) -> bool:',
          '    for i in range(len(lower) - 2):',
          '        chunk = lower[i:i + 3]',
          '        step = ord(chunk[1]) - ord(chunk[0])',
          '        if re.fullmatch(r"[a-z0-9]{3}", chunk) and abs(step) == 1 and ord(chunk[2]) - ord(chunk[1]) == step:',
          '            return True',
          '    return False',
          '',
        ]
      : []),
    ...(policy.forbidKeyboard
      ? [
          '',
          'def _has_keyboard_run(lower: str) -> bool:',
          '    for row in KEYBOARD_ROWS:',
          '        for line in (row, row[::-1]):',
          '            if any(line[i:i + 4] in lower for i in range(len(line) - 3)):',
          '                return True',
          '    return False',
          '',
        ]
      : []),
    '',
    'def validate_password(pw: str) -> list[str]:',
    '    errors = []',
    needsLower(policy) && '    lower = pw.lower()',
    `    if len(pw) < ${policy.minLength}:`,
    `        errors.append(${double(m.length)})`,
    ...(policy.requireUppercase ? ['    if not re.search(r"[A-Z]", pw):', `        errors.append(${double(m.upper)})`] : []),
    ...(policy.requireLowercase ? ['    if not re.search(r"[a-z]", pw):', `        errors.append(${double(m.lower)})`] : []),
    ...(policy.requireDigit ? ['    if not re.search(r"[0-9]", pw):', `        errors.append(${double(m.digit)})`] : []),
    ...(policy.requireSymbol ? ['    if not any(ch in SYMBOLS for ch in pw):', `        errors.append(${double(m.symbol)})`] : []),
    ...(policy.forbidSequential ? ['    if _has_sequential(lower):', `        errors.append(${double(m.sequential)})`] : []),
    ...(policy.forbidRepeated ? ['    if re.search(r"(.)\\1{2,}", pw):', `        errors.append(${double(m.repeated)})`] : []),
    ...(policy.forbidKeyboard ? ['    if _has_keyboard_run(lower):', `        errors.append(${double(m.keyboard)})`] : []),
    policy.forbidCommon && `    # ${COMMON_NOTE}`,
    '    return errors',
  );
}

// ── Go ──

function golang(policy: PasswordPolicy): string {
  const m = ruleMessages(policy);
  // Go 對沒用到的 import 與變數直接編譯失敗，所以都要跟著規則開關
  const usesStrings = policy.requireUppercase || policy.requireLowercase || policy.requireDigit || policy.requireSymbol || needsLower(policy);
  return lines(
    'package password',
    '',
    'import (',
    usesStrings && '\t"strings"',
    '\t"unicode/utf8"',
    ')',
    '',
    policy.requireSymbol && `const symbols = ${double(policy.symbolSet)}`,
    policy.requireSymbol && '',
    policy.forbidKeyboard && `var keyboardRows = []string{${ROWS.map(double).join(', ')}}`,
    policy.forbidKeyboard && '',
    'func ValidatePassword(pw string) []string {',
    '\tvar errs []string',
    needsLower(policy) && '\tlower := strings.ToLower(pw)',
    `\tif utf8.RuneCountInString(pw) < ${policy.minLength} {`,
    `\t\terrs = append(errs, ${double(m.length)})`,
    '\t}',
    ...(policy.requireUppercase ? ['\tif !strings.ContainsAny(pw, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {', `\t\terrs = append(errs, ${double(m.upper)})`, '\t}'] : []),
    ...(policy.requireLowercase ? ['\tif !strings.ContainsAny(pw, "abcdefghijklmnopqrstuvwxyz") {', `\t\terrs = append(errs, ${double(m.lower)})`, '\t}'] : []),
    ...(policy.requireDigit ? ['\tif !strings.ContainsAny(pw, "0123456789") {', `\t\terrs = append(errs, ${double(m.digit)})`, '\t}'] : []),
    ...(policy.requireSymbol ? ['\tif !strings.ContainsAny(pw, symbols) {', `\t\terrs = append(errs, ${double(m.symbol)})`, '\t}'] : []),
    ...(policy.forbidSequential ? ['\tif hasSequential([]rune(lower)) {', `\t\terrs = append(errs, ${double(m.sequential)})`, '\t}'] : []),
    ...(policy.forbidRepeated ? ['\tif hasRepeated([]rune(pw)) {', `\t\terrs = append(errs, ${double(m.repeated)})`, '\t}'] : []),
    ...(policy.forbidKeyboard ? ['\tif hasKeyboardRun(lower) {', `\t\terrs = append(errs, ${double(m.keyboard)})`, '\t}'] : []),
    policy.forbidCommon && `\t// ${COMMON_NOTE}`,
    '\treturn errs',
    '}',
    ...(policy.forbidSequential
      ? [
          '',
          'func hasSequential(lower []rune) bool {',
          '\tisAlnum := func(r rune) bool { return (r >= \'a\' && r <= \'z\') || (r >= \'0\' && r <= \'9\') }',
          '\tfor i := 0; i+3 <= len(lower); i++ {',
          '\t\ta, b, c := lower[i], lower[i+1], lower[i+2]',
          '\t\tstep := b - a',
          '\t\tif isAlnum(a) && isAlnum(b) && isAlnum(c) && (step == 1 || step == -1) && c-b == step {',
          '\t\t\treturn true',
          '\t\t}',
          '\t}',
          '\treturn false',
          '}',
        ]
      : []),
    ...(policy.forbidRepeated
      ? [
          '',
          'func hasRepeated(chars []rune) bool {',
          '\trun := 1',
          '\tfor i := 1; i < len(chars); i++ {',
          '\t\tif chars[i] != chars[i-1] {',
          '\t\t\trun = 0',
          '\t\t}',
          '\t\trun++',
          '\t\tif run >= 3 {',
          '\t\t\treturn true',
          '\t\t}',
          '\t}',
          '\treturn false',
          '}',
        ]
      : []),
    ...(policy.forbidKeyboard
      ? [
          '',
          'func hasKeyboardRun(lower string) bool {',
          '\tfor _, row := range keyboardRows {',
          '\t\treversed := []byte(row)',
          '\t\tfor i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {',
          '\t\t\treversed[i], reversed[j] = reversed[j], reversed[i]',
          '\t\t}',
          '\t\tfor _, line := range []string{row, string(reversed)} {',
          '\t\t\tfor i := 0; i+4 <= len(line); i++ {',
          '\t\t\t\tif strings.Contains(lower, line[i:i+4]) {',
          '\t\t\t\t\treturn true',
          '\t\t\t\t}',
          '\t\t\t}',
          '\t\t}',
          '\t}',
          '\treturn false',
          '}',
        ]
      : []),
  );
}

// ── Java ──

function java(policy: PasswordPolicy): string {
  const m = ruleMessages(policy);
  const usesPattern = policy.requireUppercase || policy.requireLowercase || policy.requireDigit || policy.forbidRepeated;
  return lines(
    'import java.util.ArrayList;',
    'import java.util.List;',
    needsLower(policy) && 'import java.util.Locale;',
    usesPattern && 'import java.util.regex.Pattern;',
    '',
    'public final class PasswordPolicy {',
    policy.requireSymbol && `    private static final String SYMBOLS = ${double(policy.symbolSet)};`,
    policy.forbidKeyboard && `    private static final String[] KEYBOARD_ROWS = {${ROWS.map(double).join(', ')}};`,
    (policy.requireSymbol || policy.forbidKeyboard) && '',
    '    public static List<String> validate(String pw) {',
    '        List<String> errors = new ArrayList<>();',
    needsLower(policy) && '        String lower = pw.toLowerCase(Locale.ROOT);',
    `        if (pw.codePointCount(0, pw.length()) < ${policy.minLength}) {`,
    `            errors.add(${double(m.length)});`,
    '        }',
    ...(policy.requireUppercase ? ['        if (!Pattern.compile("[A-Z]").matcher(pw).find()) {', `            errors.add(${double(m.upper)});`, '        }'] : []),
    ...(policy.requireLowercase ? ['        if (!Pattern.compile("[a-z]").matcher(pw).find()) {', `            errors.add(${double(m.lower)});`, '        }'] : []),
    ...(policy.requireDigit ? ['        if (!Pattern.compile("[0-9]").matcher(pw).find()) {', `            errors.add(${double(m.digit)});`, '        }'] : []),
    ...(policy.requireSymbol ? ['        if (pw.codePoints().noneMatch(c -> SYMBOLS.indexOf(c) >= 0)) {', `            errors.add(${double(m.symbol)});`, '        }'] : []),
    ...(policy.forbidSequential ? ['        if (hasSequential(lower)) {', `            errors.add(${double(m.sequential)});`, '        }'] : []),
    ...(policy.forbidRepeated ? ['        if (Pattern.compile("(.)\\\\1{2,}").matcher(pw).find()) {', `            errors.add(${double(m.repeated)});`, '        }'] : []),
    ...(policy.forbidKeyboard ? ['        if (hasKeyboardRun(lower)) {', `            errors.add(${double(m.keyboard)});`, '        }'] : []),
    policy.forbidCommon && `        // ${COMMON_NOTE}`,
    '        return errors;',
    '    }',
    ...(policy.forbidSequential
      ? [
          '',
          '    private static boolean hasSequential(String lower) {',
          '        for (int i = 0; i + 3 <= lower.length(); i++) {',
          '            String chunk = lower.substring(i, i + 3);',
          '            int step = chunk.charAt(1) - chunk.charAt(0);',
          '            if (chunk.matches("[a-z0-9]{3}") && Math.abs(step) == 1 && chunk.charAt(2) - chunk.charAt(1) == step) {',
          '                return true;',
          '            }',
          '        }',
          '        return false;',
          '    }',
        ]
      : []),
    ...(policy.forbidKeyboard
      ? [
          '',
          '    private static boolean hasKeyboardRun(String lower) {',
          '        for (String row : KEYBOARD_ROWS) {',
          '            for (String line : new String[] {row, new StringBuilder(row).reverse().toString()}) {',
          '                for (int i = 0; i + 4 <= line.length(); i++) {',
          '                    if (lower.contains(line.substring(i, i + 4))) {',
          '                        return true;',
          '                    }',
          '                }',
          '            }',
          '        }',
          '        return false;',
          '    }',
        ]
      : []),
    '}',
  );
}

// ── Kotlin（Android） ──

function kotlin(policy: PasswordPolicy): string {
  const m = ruleMessages(policy);
  return lines(
    'object PasswordPolicy {',
    policy.requireSymbol && `    private val SYMBOLS = ${kotlinString(policy.symbolSet)}.codePoints().toArray().toSet()`,
    policy.forbidKeyboard && `    private val KEYBOARD_ROWS = listOf(${ROWS.map(double).join(', ')})`,
    (policy.requireSymbol || policy.forbidKeyboard) && '',
    '    fun validate(pw: String): List<String> {',
    '        val errors = mutableListOf<String>()',
    needsLower(policy) && '        val lower = pw.lowercase()',
    `        if (pw.codePointCount(0, pw.length) < ${policy.minLength}) errors += ${kotlinString(m.length)}`,
    policy.requireUppercase && `        if (!Regex("[A-Z]").containsMatchIn(pw)) errors += ${kotlinString(m.upper)}`,
    policy.requireLowercase && `        if (!Regex("[a-z]").containsMatchIn(pw)) errors += ${kotlinString(m.lower)}`,
    policy.requireDigit && `        if (!Regex("[0-9]").containsMatchIn(pw)) errors += ${kotlinString(m.digit)}`,
    policy.requireSymbol && `        if (pw.codePoints().noneMatch { it in SYMBOLS }) errors += ${kotlinString(m.symbol)}`,
    policy.forbidSequential && `        if (hasSequential(lower)) errors += ${kotlinString(m.sequential)}`,
    policy.forbidRepeated && `        if (Regex("(.)\\\\1{2,}").containsMatchIn(pw)) errors += ${kotlinString(m.repeated)}`,
    policy.forbidKeyboard && `        if (hasKeyboardRun(lower)) errors += ${kotlinString(m.keyboard)}`,
    policy.forbidCommon && `        // ${COMMON_NOTE}`,
    '        return errors',
    '    }',
    ...(policy.forbidSequential
      ? [
          '',
          '    private fun hasSequential(lower: String): Boolean =',
          '        (0..lower.length - 3).any { i ->',
          '            val chunk = lower.substring(i, i + 3)',
          '            val step = chunk[1] - chunk[0]',
          '            Regex("[a-z0-9]{3}").matches(chunk) && (step == 1 || step == -1) && chunk[2] - chunk[1] == step',
          '        }',
        ]
      : []),
    ...(policy.forbidKeyboard
      ? [
          '',
          '    private fun hasKeyboardRun(lower: String): Boolean =',
          '        KEYBOARD_ROWS.flatMap { listOf(it, it.reversed()) }',
          '            .any { line -> line.windowed(4).any { it in lower } }',
        ]
      : []),
    '}',
  );
}

// ── Swift（iOS） ──

function swift(policy: PasswordPolicy): string {
  const m = ruleMessages(policy);
  const regexCheck = (pattern: string, message: string) => [
    `        if pw.range(of: "${pattern}", options: .regularExpression) == nil {`,
    `            errors.append(${double(message)})`,
    '        }',
  ];
  return lines(
    'import Foundation',
    '',
    'enum PasswordPolicy {',
    policy.requireSymbol && `    static let symbols = Set(${double(policy.symbolSet)}.unicodeScalars)`,
    policy.forbidKeyboard && `    static let keyboardRows = [${ROWS.map(double).join(', ')}]`,
    (policy.requireSymbol || policy.forbidKeyboard) && '',
    '    static func validate(_ pw: String) -> [String] {',
    '        var errors: [String] = []',
    // 用 unicodeScalars 而不是 Character：Character 是字位叢集，長度與比對都會跟其他語言對不上
    '        let scalars = Array(pw.unicodeScalars)',
    needsLower(policy) && '        let lower = Array(pw.lowercased().unicodeScalars)',
    `        if scalars.count < ${policy.minLength} {`,
    `            errors.append(${double(m.length)})`,
    '        }',
    ...(policy.requireUppercase ? regexCheck('[A-Z]', m.upper) : []),
    ...(policy.requireLowercase ? regexCheck('[a-z]', m.lower) : []),
    ...(policy.requireDigit ? regexCheck('[0-9]', m.digit) : []),
    ...(policy.requireSymbol ? ['        if !scalars.contains(where: symbols.contains) {', `            errors.append(${double(m.symbol)})`, '        }'] : []),
    ...(policy.forbidSequential ? ['        if hasSequential(lower) {', `            errors.append(${double(m.sequential)})`, '        }'] : []),
    ...(policy.forbidRepeated ? ['        if hasRepeated(scalars) {', `            errors.append(${double(m.repeated)})`, '        }'] : []),
    ...(policy.forbidKeyboard ? ['        if hasKeyboardRun(lower) {', `            errors.append(${double(m.keyboard)})`, '        }'] : []),
    policy.forbidCommon && `        // ${COMMON_NOTE}`,
    '        return errors',
    '    }',
    ...(policy.forbidSequential
      ? [
          '',
          '    static func hasSequential(_ lower: [Unicode.Scalar]) -> Bool {',
          '        guard lower.count >= 3 else { return false }',
          '        for i in 0...(lower.count - 3) {',
          '            let codes = lower[i..<(i + 3)].map { Int($0.value) }',
          '            let isAlnum = codes.allSatisfy { (48...57).contains($0) || (97...122).contains($0) }',
          '            let step = codes[1] - codes[0]',
          '            if isAlnum && abs(step) == 1 && codes[2] - codes[1] == step {',
          '                return true',
          '            }',
          '        }',
          '        return false',
          '    }',
        ]
      : []),
    ...(policy.forbidRepeated
      ? [
          '',
          '    static func hasRepeated(_ scalars: [Unicode.Scalar]) -> Bool {',
          '        var run = 1',
          '        for i in scalars.indices.dropFirst() {',
          '            run = scalars[i] == scalars[i - 1] ? run + 1 : 1',
          '            if run >= 3 {',
          '                return true',
          '            }',
          '        }',
          '        return false',
          '    }',
        ]
      : []),
    ...(policy.forbidKeyboard
      ? [
          '',
          '    static func hasKeyboardRun(_ lower: [Unicode.Scalar]) -> Bool {',
          '        guard lower.count >= 4 else { return false }',
          '        for row in keyboardRows {',
          '            let forward = Array(row.unicodeScalars)',
          '            for line in [forward, Array(forward.reversed())] {',
          '                for i in 0...(line.count - 4) {',
          '                    let run = line[i..<(i + 4)]',
          '                    if (0...(lower.count - 4)).contains(where: { lower[$0..<($0 + 4)] == run }) {',
          '                        return true',
          '                    }',
          '                }',
          '            }',
          '        }',
          '        return false',
          '    }',
        ]
      : []),
    '}',
  );
}

const TARGETS: { id: string; label: string; build(policy: PasswordPolicy): string }[] = [
  { id: 'laravel', label: 'Laravel', build: laravelRule },
  { id: 'ci3', label: 'CodeIgniter 3', build: ci3 },
  { id: 'ci4', label: 'CodeIgniter 4', build: ci4 },
  { id: 'java', label: 'Java', build: java },
  { id: 'go', label: 'Go', build: golang },
  { id: 'python', label: 'Python', build: python },
  { id: 'kotlin', label: 'Kotlin（Android）', build: kotlin },
  { id: 'swift', label: 'Swift（iOS）', build: swift },
];

export function validationSnippets(policy: PasswordPolicy): RuleSnippet[] {
  return TARGETS.map(({ id, label, build }) => ({ id, label, code: build(policy) }));
}
