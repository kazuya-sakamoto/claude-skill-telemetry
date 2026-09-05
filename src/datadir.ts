import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const NAME = "claude-skill-telemetry";

/** state とロックを repo ごとに分ける鍵。パスそのものは書かない（リポジトリ名を漏らさない）。 */
export function repoKey(repoRoot: string): string {
  return createHash("sha256").update(repoRoot).digest("hex").slice(0, 16);
}

/**
 * 状態の置き場。フック経由では `CLAUDE_PLUGIN_DATA` が入るが、手で叩くと入らない。
 * env だけを見ると手動実行が tmpdir を向き、`--status` がフックの生死を返せず
 * ロックも互いに効かなくなる。env が無いときは実際の置き場を探しに行く。
 *
 * install 版（`claude-skill-telemetry`）と `--plugin-dir` 版（`-inline` 付き）は別 ID になるので、
 * 読むときは両方を新しい順に見る。書くのは先頭だけ。
 */
export function dataDirs(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const explicit = env.CLAUDE_PLUGIN_DATA;
  if (explicit) return [explicit];

  const root = join(home, ".claude", "plugins", "data");
  const found: { path: string; mtime: number }[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    /* データ領域がまだ無い */
  }
  for (const n of names) {
    if (n !== NAME && !n.startsWith(`${NAME}-`)) continue;
    const path = join(root, n);
    try {
      found.push({ path, mtime: statSync(path).mtimeMs });
    } catch {
      /* 消えた・読めないディレクトリは無かったことにする */
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found.length ? found.map((f) => f.path) : [join(tmpdir(), NAME)];
}

/** 書き込み先。読むときは dataDirs() を全部見る。 */
export function dataDir(env?: NodeJS.ProcessEnv, home?: string): string {
  return dataDirs(env, home)[0] as string;
}
