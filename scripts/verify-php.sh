#!/usr/bin/env bash
# 以本機 PHP 實跑，逐項比對 hash／HMAC／URL／HTML／serialize 的輸出，把「相容於 PHP」變成可執行的斷言。
# 需要先編譯：npm run verify:php（會先跑 build:tests）。任何一項不一致就 exit 1。
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

command -v php >/dev/null 2>&1 || { echo "verify-php: 需要 php CLI" >&2; exit 1; }
[ -f out/src/core/hash/compat.js ] || { echo "verify-php: 找不到編譯產物，請改用 npm run verify:php" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "==> 產生測試輸入（$(php -r 'echo PHP_VERSION;')）"
node - "$work/inputs.json" <<'NODE'
const fs = require('fs');
const inputs = [
  '', 'hello', 'The quick brown fox jumps over the lazy dog', '測試中文', 'emoji 😀 and 中文',
  'a b~c*d/中&"<x>\'é', 'x15', ' leading and trailing ', 'line1\nline2\r\n', '©®™ café naïve',
  'a'.repeat(1000), String.fromCharCode(0, 1, 2, 255), '<script>alert("x")</script>', '100% & 50%',
];
fs.writeFileSync(process.argv[2], JSON.stringify(inputs));
NODE

echo "==> PHP 計算"
php -r '
$inputs = json_decode(file_get_contents($argv[1]), true);
$algos = ["md4","md5","sha1","sha224","sha256","sha384","sha512","sha512/224","sha512/256","sha3-224","sha3-256","sha3-384","sha3-512","ripemd160","whirlpool","crc32","crc32b","crc32c","adler32"];
$out = [];
foreach ($inputs as $s) {
  $row = ["hash" => [], "hmac" => []];
  foreach ($algos as $a) { $row["hash"][$a] = hash($a, $s); }
  foreach (["md5","sha1","sha256","sha512","sha3-256"] as $a) { $row["hmac"][$a] = hash_hmac($a, $s, "k3y"); }
  $row["crc32dec"] = sprintf("%u", crc32($s));
  $row["urlencode"] = urlencode($s);
  $row["rawurlencode"] = rawurlencode($s);
  $row["htmlspecialchars"] = htmlspecialchars($s);
  $row["htmlentities"] = htmlentities($s);
  $row["serialize"] = serialize($s);
  $out[] = $row;
}
$out[] = ["serializeArray" => serialize(["a" => 1, "b" => [1.5, true, null], "中" => "文字", 5 => "x", "f" => 1e25, "g" => 0.1, "neg" => -3])];
file_put_contents($argv[2], json_encode($out));
' "$work/inputs.json" "$work/php.json"

echo "==> 比對"
node - "$work/inputs.json" "$work/php.json" <<'NODE'
const fs = require('fs');
const path = require('path');
const out = (p) => require(path.resolve('out/src/core', p));
const { buildHashTable, buildHmacTable } = out('hash/compat.js');
const { decodeInput } = out('hash/bytes.js');
const web = out('encode/web.js');
const { phpSerialize } = out('encode/phpSerialize.js');
const { parseJson } = out('json/ast.js');

const inputs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const php = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
let checked = 0;
const failures = [];
const skipped = new Set();
const same = (label, input, ours, theirs) => {
  checked += 1;
  if (ours !== theirs) {
    failures.push(`${label} ${JSON.stringify(input).slice(0, 40)}\n    ours: ${ours}\n    php : ${theirs}`);
  }
};

inputs.forEach((input, i) => {
  const expected = php[i];
  const bytes = decodeInput(input, 'text');
  const table = buildHashTable(bytes, { inputMode: 'text', format: 'hex', text: input });
  for (const [algo, value] of Object.entries(expected.hash)) {
    const row = table.rows.find((r) => r.id === algo);
    if (!row) {
      skipped.add(algo);
      continue;
    }
    same(`hash ${algo}`, input, row.value, value);
  }
  same('crc32() 十進位', input, table.rows.find((r) => r.id === 'crc32-decimal').value, expected.crc32dec);
  const hmacRows = buildHmacTable(bytes, decodeInput('k3y', 'text'), { inputMode: 'text', format: 'hex' });
  for (const [algo, value] of Object.entries(expected.hmac)) {
    same(`hmac ${algo}`, input, hmacRows.find((r) => r.id === `hmac-${algo}`).value, value);
  }
  same('urlencode', input, web.phpUrlencode(input), expected.urlencode);
  same('rawurlencode', input, web.phpRawurlencode(input), expected.rawurlencode);
  same('htmlspecialchars', input, web.phpHtmlspecialchars(input), expected.htmlspecialchars);
  same('htmlentities', input, web.phpHtmlentities(input), expected.htmlentities);
  same('serialize', input, phpSerialize({ type: 'string', start: 0, value: input }), expected.serialize);
});
const arrayCase = php[php.length - 1];
same('serialize 陣列', 'array', phpSerialize(parseJson('{"a":1,"b":[1.5,true,null],"中":"文字","5":"x","f":1e25,"g":0.1,"neg":-3}')), arrayCase.serializeArray);

if (skipped.size) {
  console.log(`略過（此 Node 環境的 OpenSSL 沒有）：${[...skipped].join(', ')}`);
}
if (failures.length) {
  console.error(`✗ ${failures.length}／${checked} 項與 PHP 不一致：\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ ${checked} 項全部與 PHP 相同`);
NODE
