import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sync } from "../src/sync.js";

/**
 * 本番の入口（セッション開始フック）は例外を投げず Outcome を返す契約。
 * 「同期するものが無かった」と「そもそも動いていない」を区別する出口を固定する。
 */
const dirs: string[] = [];

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** since は必須キーなので、設定を置くテストは最低限これを書く。 */
const MIN = '{"since":"1970-01-01"}';

function repoWithConfig(body = MIN): string {
  const d = tmp("cst-sync-");
  mkdirSync(join(d, ".claude"), { recursive: true });
  writeFileSync(join(d, ".claude/skill-telemetry.json"), body);
  return d;
}

beforeEach(() => {
  process.env.CLAUDE_PLUGIN_DATA = tmp("cst-sync-state-");
});

afterEach(() => {
  delete process.env.CLAUDE_PLUGIN_DATA;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("セッション開始フックの出口", () => {
  it("設定が無いリポジトリでは何もしない", () => {
    expect(sync(tmp("cst-sync-"))).toBe("skipped:no-config");
  });

  it("opt-out マーカーがあれば降りる", () => {
    const d = repoWithConfig();
    writeFileSync(join(d, ".claude/no-skill-log"), "");
    expect(sync(d)).toBe("skipped:opt-out");
  });

  it("壊れた設定では黙って既定値で進まない", () => {
    expect(sync(repoWithConfig('{"since":"1970-01-01","sync":{"level":"pr"}}'))).toBe("skipped:config-error");
    expect(sync(repoWithConfig("{壊れたJSON"))).toBe("skipped:config-error");
  });

  it("書き込み先の身元が決まらなければ書かない", () => {
    // machineID を持たない home を渡す。実マシンの ~/.claude.json に依存させない。
    expect(sync(repoWithConfig(), tmp("cst-sync-home-"))).toBe("skipped:identity");
  });
});
