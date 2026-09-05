import { resolve } from "node:path";
import type { Config } from "./config.js";
import { CONFIG_PATH, hasConfig, isDisabled, loadConfig } from "./config.js";
import { dataDir } from "./datadir.js";
import { resolveIdentity } from "./identity.js";
import { collect, write } from "./ledger.js";
import { report } from "./report.js";
import { readOutcome, recordOutcome, sync } from "./sync.js";
import { acquire } from "./lock.js";
import { BUILTIN } from "./scan.js";
import { discoverSkills } from "./skills.js";
import { findTranscripts } from "./transcript.js";

const USAGE = `claude-skill-telemetry — Claude Code の transcript からスキル実行を復元して記録する

  skill-telemetry --sync        セッション開始フック用。走査→書込を一息に行う（無言・exit 0）
  skill-telemetry               走査して書き込む（設定の since 以降）
  skill-telemetry --dry-run     書き込まず、追加/更新される件数と除外内訳を表示
  skill-telemetry --report      リポジトリ内の全ログを集計表示（transcript は読まない）
  skill-telemetry --status      設定・書き込み先・対象スキルを表示

  --repo <path>                 対象リポジトリ（既定: $CLAUDE_PROJECT_DIR または cwd）
`;

/** state の置き場は install 版と --plugin-dir 版で変わる。読み口を 1 箇所にまとめる。 */
function lastHookLine(root: string): string {
  const last = readOutcome(root);
  return `last hook:   ${last ? `${last.outcome}（${last.ts}）${last.detail ?? ""}` : "記録なし"}`;
}

function repoRoot(argv: string[]): string {
  const i = argv.indexOf("--repo");
  if (i >= 0 && argv[i + 1]) return resolve(argv[i + 1] as string);
  return resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
}

/**
 * フック経由の起動であることの証明として stdin の JSON を要求する。
 * async フックは timeout が強制されないため、閉じないパイプで固まらないよう自前で打ち切る。
 *
 * 手打ち（"tty"）とフック不調（null）を分けるのは、前者で state を上書きすると
 * 最後に本物のフックが何をしたかという唯一の手掛かりが消えるため。
 */
async function hookInput(timeoutMs = 5000): Promise<unknown | "tty" | null> {
  if (process.stdin.isTTY) return "tty";
  return new Promise((done) => {
    let buf = "";
    const finish = (v: unknown | null): void => {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      done(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c: string) => {
      buf += c;
    });
    process.stdin.on("end", () => {
      try {
        finish(JSON.parse(buf));
      } catch {
        finish(null);
      }
    });
    process.stdin.on("error", () => finish(null));
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const root = repoRoot(argv);

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }

  if (argv.includes("--sync")) {
    const input = await hookInput();
    if (input === "tty") {
      process.stderr.write("--sync はセッション開始フック専用。手元で確かめるなら --dry-run か --status を使う\n");
      process.exitCode = 1;
      return;
    }
    // フックのはずなのに入力が無い＝フックが壊れている。無言で降りるが痕跡は残す。
    if (input === null) {
      recordOutcome(root, "skipped:no-hook-input");
      return;
    }
    sync(root);
    return;
  }

  if (!hasConfig(root)) {
    process.stderr.write(`${root} は対象外（${CONFIG_PATH} が無い）\n`);
    process.exitCode = 1;
    return;
  }
  let cfg: Config;
  try {
    cfg = loadConfig(root);
  } catch (e) {
    const msg = (e as Error).message;
    // 設定が壊れているときこそフックの生死を見たい。--status は出せるところまで出す。
    if (argv.includes("--status")) {
      process.stdout.write(
        [`repo:        ${root}`, `config:      ${CONFIG_PATH}（読めない: ${msg}）`, `data dir:    ${dataDir()}`, lastHookLine(root), ""].join("\n"),
      );
    } else {
      // 他の拒否経路と同じ形で返す。設定を書き間違えた人に見せるのがスタックトレースでは伝わらない。
      process.stderr.write(`${msg}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (argv.includes("--report")) {
    process.stdout.write(report(root, cfg) + "\n");
    return;
  }

  const id = resolveIdentity(cfg);
  const skills = discoverSkills(root, cfg);

  // 身元が決まらない状況こそ status を見たいので、identity の中止判定より前に出す。
  if (argv.includes("--status")) {
    // 組み込みコマンドと同名のスキルは記録されない。黙って消えるのが一番たちが悪いので名指しする。
    const shadowed = [...skills].filter((s) => BUILTIN.has(s)).sort();
    process.stdout.write(
      [
        `repo:        ${root}`,
        `config:      ${CONFIG_PATH}${isDisabled(root) ? "（opt-out 有効・記録しない）" : ""}`,
        `timezone:    ${cfg.timezone}（ts 粒度 ${cfg.tsPrecision}）`,
        `since:       ${cfg.since}`,
        `writer:      ${"error" in id ? `決められない（${id.error}）` : id.id.machineId8}`,
        `sync level:  ${cfg.sync.level}`,
        `data dir:    ${dataDir()}`,
        `transcripts: ${findTranscripts(root).length} 本`,
        `skills:      ${skills.size} 種  ${[...skills].sort().join(" ")}`,
        ...(shadowed.length ? [`warning:     組み込みコマンドと同名のため記録されない: ${shadowed.join(" ")}`] : []),
        lastHookLine(root),
        "",
      ].join("\n"),
    );
    return;
  }

  if ("error" in id) {
    process.stderr.write(`書き込み先を決められないので中止（${id.error}）\n`);
    process.exitCode = 1;
    return;
  }

  if (isDisabled(root)) {
    process.stderr.write("opt-out が有効なので記録しない\n");
    process.exitCode = 1;
    return;
  }

  const dry = argv.includes("--dry-run");
  const paths = findTranscripts(root);
  const opts = { timezone: cfg.timezone, tsPrecision: cfg.tsPrecision, excludeCommands: cfg.excludeCommands };
  const { runs, dropped } = collect(paths, skills, opts);

  // NDJSON の read-merge-write はフックと競合しうる（R3）。読み取りだけの --dry-run は妨げない。
  const lock = dry ? null : acquire(root);
  if (!dry && !lock) {
    process.stderr.write("他のプロセスが同期中なので中止（放置されたロックは 10 分で解放される）\n");
    process.exitCode = 1;
    return;
  }
  let results, skipped;
  try {
    ({ results, skipped } = write(runs, { repoRoot: root, cfg, machineId8: id.id.machineId8, dry }));
  } finally {
    lock?.release();
  }

  const out: string[] = [];
  out.push(`${dry ? "[dry-run] " : ""}transcript ${paths.length} 本 → 対象 ${runs.size} 件（対象外 ${dropped} 件）`);
  out.push(`書き込み先: ${cfg.skillsDir}/<skill>/${cfg.logsSubdir}/${id.id.machineId8}.ndjson`);
  for (const r of results) {
    out.push(`  ${r.skill}  追加 ${r.added} / 更新 ${r.updated} / 計 ${r.total}`);
  }
  if (skipped) out.push(`  (${skipped} 件は since ${cfg.since} より前、または時刻不明)`);
  process.stdout.write(out.join("\n") + "\n");
}

void main();
