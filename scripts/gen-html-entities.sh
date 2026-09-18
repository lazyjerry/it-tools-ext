#!/usr/bin/env bash
# 由 PHP 的 get_html_translation_table() 重新產生 src/core/encode/htmlEntities.ts，確保 htmlentities 與 PHP 一致。
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v php >/dev/null 2>&1 || { echo "gen-html-entities: 需要 php CLI" >&2; exit 1; }

php -r '
$t = get_html_translation_table(HTML_ENTITIES, ENT_QUOTES | ENT_HTML401, "UTF-8");
$out = "// 由 PHP " . PHP_VERSION . " get_html_translation_table(HTML_ENTITIES, ENT_QUOTES | ENT_HTML401) 產生，勿手改。\n";
$out .= "// 重新產生：./scripts/gen-html-entities.sh\n";
$out .= "export const HTML401_ENTITIES: Readonly<Record<number, string>> = {\n";
foreach ($t as $char => $entity) { $out .= "  " . mb_ord($char, "UTF-8") . ": " . json_encode($entity) . ",\n"; }
$out .= "};\n";
file_put_contents($argv[1], $out);
echo "gen-html-entities: 已產生 ", count($t), " 筆\n";' "$root/src/core/encode/htmlEntities.ts"
