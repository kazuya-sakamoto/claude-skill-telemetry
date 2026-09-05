import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasConfig, isDisabled, loadConfig } from "./config.js";
import { dataDir, dataDirs, repoKey } from "./datadir.js";
import { resolveIdentity } from "./identity.js";
import { acquire } from "./lock.js";
import { collect, write } from "./ledger.js";
import { discoverSkills } from "./skills.js";
import { findTranscripts } from "./transcript.js";

export type Outcome =
  | "skipped:no-config"
  | "skipped:no-hook-input"
  | "skipped:opt-out"
  | "skipped:config-error"
  | "skipped:identity"
  | "skipped:locked"
  | "clean"
  | "wrote"
  | "failed:exception";

/**
 * 全終了経路を 1 行残す。「同期するものが無かった」と「そもそも動いていない」を
 * 外から区別できないと、フックが生きているか確かめようがない。
 * 利用者のリポジトリを汚さないためプラグインのデータ領域に置く（R2）。
 */
function statePath(dir: string, repoRoot: string): string {
  return join(dir, "state", `${repoKey(repoRoot)}.json`);
}

export interface OutcomeRecord {
  ts: string;
  repo: string;
  outcome: Outcome;
  detail?: string;
}

/**
 * 直近の記録。パスの導き方（プラグインID＋repo のハッシュ）を人に要求しないための読み口。
 * install 版と `--plugin-dir` 版で ID が変わるので、候補を全部見て最新を返す。
 */
export function readOutcome(repoRoot: string): OutcomeRecord | null {
  let best: OutcomeRecord | null = null;
  for (const dir of dataDirs()) {
    try {
      const r = JSON.parse(readFileSync(statePath(dir, repoRoot), "utf8")) as OutcomeRecord;
      if (!best || r.ts > best.ts) best = r;
    } catch {
      /* この置き場には無い */
    }
  }
  return best;
}

export function recordOutcome(repoRoot: string, outcome: Outcome, detail?: string): Outcome {
  try {
    const dir = join(dataDir(), "state");
    mkdirSync(dir, { recursive: true });
    const path = statePath(dataDir(), repoRoot);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ts: new Date().toISOString(), repo: repoRoot, outcome, detail }));
    renameSync(tmp, path);
  } catch {
    /* state を残せないこと自体は同期の失敗ではない */
  }
  return outcome;
}

/**
 * セッション開始フックの本体。v1 は write レベル止まりで、git も gh も呼ばない。
 * 条件が欠けたら書き込みもしない —— transcript が残っている限り、諦めても次のセッションが
 * 同じ実行を拾い直す。
 */
export function sync(repoRoot: string, home?: string): Outcome {
  try {
    if (!hasConfig(repoRoot)) return "skipped:no-config";
    if (isDisabled(repoRoot)) return recordOutcome(repoRoot, "skipped:opt-out");

    let cfg;
    try {
      cfg = loadConfig(repoRoot);
    } catch (e) {
      return recordOutcome(repoRoot, "skipped:config-error", (e as Error).message);
    }

    const id = resolveIdentity(cfg, home);
    if ("error" in id) return recordOutcome(repoRoot, "skipped:identity", id.error);

    const lock = acquire(repoRoot);
    if (!lock) return recordOutcome(repoRoot, "skipped:locked");
    try {
      const opts = { timezone: cfg.timezone, tsPrecision: cfg.tsPrecision, excludeCommands: cfg.excludeCommands };
      const { runs } = collect(findTranscripts(repoRoot), discoverSkills(repoRoot, cfg), opts);
      const { results } = write(runs, {
        repoRoot,
        cfg,
        machineId8: id.id.machineId8,
        dry: false,
      });
      const n = results.reduce((s, r) => s + r.added + r.updated, 0);
      return recordOutcome(repoRoot, n ? "wrote" : "clean", n ? `${n} 実行` : undefined);
    } finally {
      lock.release();
    }
  } catch (e) {
    return recordOutcome(repoRoot, "failed:exception", (e as Error).message);
  }
}
