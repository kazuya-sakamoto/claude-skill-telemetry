import { mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { dataDir, repoKey } from "./datadir.js";

const STALE_MS = 10 * 60 * 1000;

function lockRoot(): string {
  // リポジトリを汚さないため state はプラグインのデータ領域に置く（R2）。
  return join(dataDir(), "locks");
}

export interface Lock {
  release(): void;
}

/**
 * 2 セッション同時起動時に NDJSON の read-merge-write が競合する（R3）。
 * mkdir の atomic 性だけで排他する。負けた側は無言で降りてよい ——
 * transcript が残っている限り、次のセッションが同じ実行を拾い直す。
 */
export function acquire(repoRoot: string, now = Date.now()): Lock | null {
  const dir = join(lockRoot(), repoKey(repoRoot));
  mkdirSync(lockRoot(), { recursive: true });
  const release = (): void => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 解放できなくても stale として次回奪われる */
    }
  };
  try {
    mkdirSync(dir);
    return { release };
  } catch {
    let age = 0;
    try {
      age = now - statSync(dir).mtimeMs;
    } catch {
      return null;
    }
    if (age < STALE_MS) return null;
    // 落ちたプロセスのロックを永久に残さない。奪取自体は競合しうるが、
    // 負けても失うのは 1 回ぶんの走査だけ。
    release();
    try {
      mkdirSync(dir);
      return { release };
    } catch {
      return null;
    }
  }
}
