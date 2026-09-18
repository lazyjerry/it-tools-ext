#!/usr/bin/env node
// 把 codegen.ts 產生的驗證程式碼拿去實際執行，逐筆密碼與 checkPassword 的判定比對，
// 讓「各語言的程式碼與面板檢查結果一致」變成可執行的斷言。需要先編譯：npm run verify:rules。
// 本機沒有的工具鏈會略過並列出；Java、Kotlin 沒有 runner（需要 JDK／kotlinc）。
/* global console */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { checkPassword, DEFAULT_POLICY } = require(path.join(root, 'out/src/core/password/policy.js'));
const { validationSnippets, ruleMessages } = require(path.join(root, 'out/src/core/password/codegen.js'));

const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;

// 固定種子：失敗時重跑得到同一批輸入
let seed = 20260918;
const rand = (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};
const pick = (list) => list[rand(list.length)];

const FLAGS = ['requireUppercase', 'requireLowercase', 'requireDigit', 'requireSymbol', 'forbidSequential', 'forbidRepeated', 'forbidKeyboard'];
const off = Object.fromEntries(FLAGS.map((f) => [f, false]));
const policies = [
  { ...DEFAULT_POLICY, forbidCommon: false },
  { ...DEFAULT_POLICY, ...off, forbidCommon: false, minLength: 1 },
  // 符號集含各語言字串常值要跳脫的字元，以及 BMP 外的字元
  { ...DEFAULT_POLICY, forbidCommon: false, minLength: 5, symbolSet: `'"\\$!é😀` },
  ...Array.from({ length: 7 }, () => ({
    ...DEFAULT_POLICY,
    ...Object.fromEntries(FLAGS.map((f) => [f, rand(2) === 1])),
    forbidCommon: false,
    minLength: 1 + rand(14),
  })),
];

const ALPHABET = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{};:,.<>?\'"\\ é中文😀'];
const SEEDS = ['abc', 'cba', 'XYZ', '789', '987', 'qwer', 'rewq', 'ASDF', 'mnbv', '0987', 'aaa', '111', '中中中', '😀😀😀', 'AAa', '89a', 'yz0'];
// 不含換行：重複字元在部分語言用正則（. 不含換行）、部分用迴圈，只有這種輸入會不同
const passwords = [
  '', 'a', 'Aa1!', 'Password1!', 'abcABC123!!!', 'Tr0ub4dor&3', '中文密碼Aa1!', '😀😀', 'é'.repeat(9),
  ...Array.from({ length: 400 }, () => {
    const parts = Array.from({ length: rand(16) }, () => pick(ALPHABET));
    if (rand(3) === 0) {
      parts.splice(rand(parts.length + 1), 0, pick(SEEDS));
    }
    return parts.join('');
  }),
];

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'itt-rules-'));
const inputFile = path.join(work, 'passwords.json');
fs.writeFileSync(inputFile, JSON.stringify(passwords));

/** 每個 runner 回傳「每筆密碼的錯誤訊息以 、 串接」的陣列。 */
const runners = {
  ci3: {
    needs: 'php',
    run(code, dir) {
      const file = path.join(dir, 'ci3.php');
      const helper = code.slice(0, code.indexOf('// Controller'));
      fs.writeFileSync(file, `<?php\n${helper}\necho json_encode(array_map(function ($pw) { return implode('、', password_policy_errors($pw)); }, json_decode(file_get_contents($argv[1]))));\n`);
      return JSON.parse(execFileSync('php', [file, inputFile], { encoding: 'utf8' }));
    },
  },
  ci4: {
    needs: 'php',
    run(code, dir) {
      const file = path.join(dir, 'ci4.php');
      const cls = code.slice(0, code.indexOf('// app/Config'));
      fs.writeFileSync(
        file,
        `${cls}\n$rules = new PasswordRules();\n$out = [];\nforeach (json_decode(file_get_contents($argv[1])) as $pw) {\n    $error = null;\n    $ok = $rules->password_policy($pw, $error);\n    if ($ok !== ($error === null)) { fwrite(STDERR, "回傳值與錯誤訊息不一致\\n"); exit(1); }\n    $out[] = $error ?? '';\n}\necho json_encode($out);\n`,
      );
      return JSON.parse(execFileSync('php', [file, inputFile], { encoding: 'utf8' }));
    },
  },
  python: {
    needs: 'python3',
    run(code, dir) {
      const file = path.join(dir, 'rules.py');
      fs.writeFileSync(file, `${code}\nimport json, sys\nprint(json.dumps(["、".join(validate_password(pw)) for pw in json.load(open(sys.argv[1], encoding="utf-8"))]))\n`);
      return JSON.parse(execFileSync('python3', [file, inputFile], { encoding: 'utf8' }));
    },
  },
  go: {
    needs: 'go',
    run(code, dir) {
      const file = path.join(dir, 'main.go');
      const main = code.replace('package password', 'package main').replace('import (', 'import (\n\t"encoding/json"\n\t"fmt"\n\t"os"');
      fs.writeFileSync(
        file,
        `${main}\nfunc main() {\n\traw, _ := os.ReadFile(os.Args[1])\n\tvar pws []string\n\tjson.Unmarshal(raw, &pws)\n\tout := make([]string, len(pws))\n\tfor i, pw := range pws {\n\t\tfor j, e := range ValidatePassword(pw) {\n\t\t\tif j > 0 {\n\t\t\t\tout[i] += "、"\n\t\t\t}\n\t\t\tout[i] += e\n\t\t}\n\t}\n\tb, _ := json.Marshal(out)\n\tfmt.Println(string(b))\n}\n`,
      );
      return JSON.parse(execFileSync('go', ['run', file, inputFile], { encoding: 'utf8', env: { ...process.env, GO111MODULE: 'off' } }));
    },
  },
  swift: {
    needs: 'swiftc',
    run(code, dir) {
      const file = path.join(dir, 'main.swift');
      fs.writeFileSync(
        file,
        `${code}\nlet data = try! Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))\nlet pws = try! JSONDecoder().decode([String].self, from: data)\nlet out = pws.map { PasswordPolicy.validate($0).joined(separator: "、") }\nprint(String(data: try! JSONEncoder().encode(out), encoding: .utf8)!)\n`,
      );
      const bin = path.join(dir, 'rules');
      execFileSync('swiftc', ['-o', bin, file], { stdio: ['ignore', 'ignore', 'inherit'] });
      return JSON.parse(execFileSync(bin, [inputFile], { encoding: 'utf8' }));
    },
  },
};

const ORDER = ['length', 'upper', 'lower', 'digit', 'symbol', 'sequential', 'repeated', 'keyboard'];
let failures = 0;
let compared = 0;
const skipped = new Set(['java（無 runner）', 'kotlin（無 runner）']);

try {
  policies.forEach((policy, index) => {
    const messages = ruleMessages(policy);
    const expected = passwords.map((pw) =>
      checkPassword(pw, policy)
        .rules.filter((r) => !r.passed)
        .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
        .map((r) => messages[r.id])
        .join('、'),
    );
    const snippets = new Map(validationSnippets(policy).map((s) => [s.id, s.code]));
    for (const [id, runner] of Object.entries(runners)) {
      if (!has(runner.needs)) {
        skipped.add(`${id}（缺 ${runner.needs}）`);
        continue;
      }
      const dir = fs.mkdtempSync(path.join(work, `${id}-`));
      const actual = runner.run(snippets.get(id), dir);
      let bad = 0;
      actual.forEach((value, i) => {
        compared += 1;
        if (value !== expected[i]) {
          bad += 1;
          if (bad <= 3) {
            console.error(`✗ 規則 #${index} ${id}：${JSON.stringify(passwords[i])}\n    預期「${expected[i]}」\n    實際「${value}」`);
          }
        }
      });
      failures += bad;
      console.log(`${bad === 0 ? '✓' : '✗'} 規則 #${index} ${id}：${actual.length} 筆${bad ? `，${bad} 筆不一致` : ''}`);
    }
  });
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(`\n比對 ${compared} 項，不一致 ${failures} 項；略過：${[...skipped].join('、')}`);
process.exit(failures === 0 ? 0 : 1);
