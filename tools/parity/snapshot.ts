/**
 * 実 transcript に対する出力を凍結し、後から突き合わせる。リファクタの安全網。
 *
 *   npm run parity -- <repo> capture   いまの出力を baseline として保存する
 *   npm run parity -- <repo> verify    保存済み baseline と突き合わせ、差分があれば exit 1
 *
 * baseline は実スキル名とタイムスタンプを含むのでリポジトリには置かない（tools/parity/out/ は gitignore 済み）。
 * 合成 fixture と違い、実データにしか現れない形（非連続 requestId・requestId 欠落）を丸ごと含むのが役目。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaults } from "../../src/config.ts";
import { collect, parseNdjson } from "../../src/ledger.ts";
import type { LogRecord } from "../../src/schema.ts";
import { discoverSkills } from "../../src/skills.ts";
import { findTranscripts, repoSlug } from "../../src/transcript.ts";

// import.meta.dirname はバンドル後の出力先を指してしまう。npm script から叩く前提で cwd に固定する。
const OUT = join(process.cwd(), "tools/parity/out");

function usage(): never {
  console.error("usage: parity <repo> capture|verify");
  process.exit(2);
}

const repo = process.argv[2];
const mode = process.argv[3];
if (!repo || (mode !== "capture" && mode !== "verify")) usage();

/** since も machineID も通さない生の走査。baseline は書き込み経路の都合から独立させる。 */
function derive(): Map<string, LogRecord> {
  const cfg = defaults();
  const opts = { timezone: "Asia/Tokyo", tsPrecision: "second" as const };
  const paths = findTranscripts(repo);
  const { runs, dropped } = collect(paths, discoverSkills(repo, cfg), opts);
  console.log(`transcript ${paths.length} 本 → ${runs.size} 件（対象外 ${dropped} 件）`);
  return runs;
}

function sorted(runs: Map<string, LogRecord>): LogRecord[] {
  return [...runs.values()].sort((a, b) => (a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0));
}

const file = join(OUT, `${repoSlug(repo)}.jsonl`);

if (mode === "capture") {
  const recs = sorted(derive());
  if (!recs.length) {
    console.error("0 件しか取れなかった。baseline として無意味なので書かない");
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(file, recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`baseline を保存: ${file}（${recs.length} 件）`);
  process.exit(0);
}

// 空の baseline を「差分なし」と報告するのが、この道具が黙って通る唯一の壊れ方。先に殺す。
if (!existsSync(file)) {
  console.error(`baseline が無い: ${file}\n先に capture を実行すること`);
  process.exit(1);
}
const base = new Map(parseNdjson(readFileSync(file, "utf8")).map((r) => [r.run_id, r]));
if (!base.size) {
  console.error(`baseline が空: ${file}`);
  process.exit(1);
}

const now = derive();
const byField = new Map<string, number>();
const lines: string[] = [];

for (const [id, o] of base) {
  const n = now.get(id);
  if (!n) {
    lines.push(`- 消えた: ${id} ${o.skill} ${o.ts}`);
    continue;
  }
  // 片側にしか無いキーも差分として数えるため、両者の和集合を見る。
  for (const k of new Set([...Object.keys(o), ...Object.keys(n)]) as Set<keyof LogRecord>) {
    if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) {
      byField.set(k, (byField.get(k) ?? 0) + 1);
      lines.push(`! ${id} ${o.skill} ${k}: ${JSON.stringify(o[k])} → ${JSON.stringify(n[k])}`);
    }
  }
}
for (const r of now.values()) if (!base.has(r.run_id)) lines.push(`+ 増えた: ${r.run_id} ${r.skill} ${r.ts}`);

console.log(`baseline ${base.size} 件 / 現在 ${now.size} 件`);
if (!lines.length) {
  console.log("差分なし");
  process.exit(0);
}
console.log(`\n差分 ${lines.length} 行:`);
for (const [k, v] of [...byField].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v} 件`);
console.log("");
for (const l of lines.slice(0, 60)) console.log(`  ${l}`);
process.exit(1);
