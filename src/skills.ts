import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";

/**
 * 記録対象のスキル名。`SKILL.md` を持つディレクトリがそのまま allowlist になる。
 * git 追跡状況では導出しない —— ログをスキル配下に置くと自分が書いたログが混ざるうえ、
 * git を呼ばずに済ませたい（v1 は外向きの出口を持たない）。
 * 共有と個人の境界は gitignore が引く: 個人スキルのログはローカルに貯まるがコミットされない。
 */
export function discoverSkills(repoRoot: string, cfg: Config): Set<string> {
  const base = join(repoRoot, cfg.skillsDir);
  if (!existsSync(base)) return new Set();
  const out = new Set<string>();
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (existsSync(join(base, e.name, "SKILL.md"))) out.add(e.name);
  }
  return out;
}

export function logDir(repoRoot: string, cfg: Config, skill: string): string {
  return join(repoRoot, cfg.skillsDir, skill, cfg.logsSubdir);
}

export function logPath(repoRoot: string, cfg: Config, skill: string, machineId8: string): string {
  return join(logDir(repoRoot, cfg, skill), `${machineId8}.ndjson`);
}

// スキルで分けた時点でファイルは十分小さく、月で更に割ると 1 行だけのファイルが量産される。
// レコードは自分の月を持っているので、ファイル名の月は冗長なうえ TZ 設定を変えるとズレる。
const LOG_FILE = /^([A-Za-z0-9_-]{1,64})\.ndjson$/;

export function listLogFiles(repoRoot: string, cfg: Config): { skill: string; machineId: string; path: string }[] {
  const out: { skill: string; machineId: string; path: string }[] = [];
  const base = join(repoRoot, cfg.skillsDir);
  if (!existsSync(base)) return out;
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = join(base, e.name, cfg.logsSubdir);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const m = LOG_FILE.exec(f);
      if (m) out.push({ skill: e.name, machineId: m[1] as string, path: join(dir, f) });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
