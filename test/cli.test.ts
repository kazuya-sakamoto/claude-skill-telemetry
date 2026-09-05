import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoKey } from "../src/datadir.js";

/**
 * 手で叩いたときの経路。dist を子プロセスで叩き、標準出力・標準エラー・終了コードだけ見る。
 * TTY 分岐だけは擬似端末が要るので自動化しない（実行時依存ゼロを崩す対価に見合わない）。
 */
const CLI = join(import.meta.dirname, "../dist/cli.js");
const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** since は必須キーなので、設定を置くテストは最低限これを書く。 */
const MIN = '{"since":"1970-01-01"}';
/** 身元を ~/.claude.json に依存させない設定。CI や新しいマシンには無いファイルなので、書き込み経路のテストはこちらを使う。 */
const WITH_ID = '{"since":"1970-01-01","identity":{"machineId":"ci-runner"}}';

function repo(config?: string): string {
  const d = tmp("cst-cli-");
  mkdirSync(join(d, ".claude"), { recursive: true });
  if (config !== undefined) writeFileSync(join(d, ".claude/skill-telemetry.json"), config);
  return d;
}

interface Run {
  code: number;
  out: string;
  err: string;
}

function run(args: string[], o: { data?: string; state?: string; home?: string } = {}): Run {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (o.state) env.CLAUDE_PLUGIN_DATA = o.state;
  // env 無しの経路（＝手打ち）を試すには、探索先である HOME ごと差し替える必要がある。
  if (o.home) {
    delete env.CLAUDE_PLUGIN_DATA;
    env.HOME = o.home;
  }
  try {
    const out = execFileSync("node", [CLI, ...args], {
      encoding: "utf8",
      stdio: "pipe",
      input: o.data ?? "",
      env,
    });
    return { code: 0, out, err: "" };
  } catch (e) {
    const x = e as { status?: number; stdout?: string; stderr?: string };
    return { code: x.status ?? -1, out: x.stdout ?? "", err: x.stderr ?? "" };
  }
}

function stateOf(dir: string, repoRoot: string): { outcome: string; detail?: string } | null {
  const p = join(dir, "state", `${repoKey(repoRoot)}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

describe("手動実行の拒否", () => {
  it("設定が無いリポジトリは 1 行で断る", () => {
    const { code, err } = run(["--repo", repo()]);
    expect(code).toBe(1);
    expect(err).toContain("は対象外");
  });

  it("未実装の sync レベルをスタックトレースでなく 1 行で断る", () => {
    const { code, err } = run(["--repo", repo('{"since":"1970-01-01","sync":{"level":"pr"}}')]);
    expect(code).toBe(1);
    expect(err).toContain("v1 では未実装");
    expect(err).not.toContain("ConfigError:");
    expect(err).not.toMatch(/\bat \w+ \(/);
  });

  it("壊れた JSON も同じ形で断る", () => {
    const { code, err } = run(["--repo", repo("{壊れたJSON")]);
    expect(code).toBe(1);
    expect(err).toContain("を読めない");
    expect(err).not.toMatch(/\bat \w+ \(/);
  });
});

describe("--sync の入口", () => {
  it("フックのはずなのに入力が無ければ、無言で降りつつ痕跡を残す", () => {
    const d = repo(MIN);
    const state = tmp("cst-state-");
    const { code, out } = run(["--sync", "--repo", d], { state });
    expect(code).toBe(0);
    expect(out).toBe("");
    expect(stateOf(state, d)?.outcome).toBe("skipped:no-hook-input");
  });

  it("正しい入力なら sync に入り、その結果が記録される", () => {
    const d = repo(MIN);
    const state = tmp("cst-state-");
    const { code } = run(["--sync", "--repo", d], { data: '{"hook_event_name":"SessionStart"}', state });
    expect(code).toBe(0);
    // このリポジトリに transcript は無いので clean。no-hook-input でないことが要点。
    expect(stateOf(state, d)?.outcome).not.toBe("skipped:no-hook-input");
  });
});

describe("同時実行の防止", () => {
  function holdLock(state: string, repoRoot: string): void {
    mkdirSync(join(state, "locks", repoKey(repoRoot)), { recursive: true });
  }

  it("他のプロセスが同期中なら書き込みに入らない", () => {
    const d = repo(WITH_ID);
    const state = tmp("cst-state-");
    holdLock(state, d);
    const { code, err } = run(["--repo", d], { state });
    expect(code).toBe(1);
    expect(err).toContain("他のプロセスが同期中");
  });

  it("読み取りだけの --dry-run はロックに妨げられない", () => {
    const d = repo(WITH_ID);
    const state = tmp("cst-state-");
    holdLock(state, d);
    const { code, out } = run(["--dry-run", "--repo", d], { state });
    expect(code).toBe(0);
    expect(out).toContain("[dry-run]");
  });
});

describe("--status", () => {
  it("身元が決まらなくても状態を出す", () => {
    const d = repo('{"since":"1970-01-01","identity":{"requireOrg":"存在しない組織"}}');
    const { code, out } = run(["--status", "--repo", d]);
    expect(code).toBe(0);
    expect(out).toContain("決められない");
    expect(out).toContain("repo:");
  });

  it("最後にフックが残した結果を見せる", () => {
    const d = repo(MIN);
    const state = tmp("cst-state-");
    run(["--sync", "--repo", d], { state });
    expect(run(["--status", "--repo", d], { state }).out).toContain("last hook:   skipped:no-hook-input");
  });

  it("CLAUDE_PLUGIN_DATA が無くてもフックが残した結果を見つける", () => {
    const d = repo(MIN);
    const home = tmp("cst-home-");
    const data = join(home, ".claude/plugins/data/claude-skill-telemetry-inline");
    mkdirSync(data, { recursive: true });
    // フック（env あり）で書いたものを、手打ち（env なし）が読めることが要点。
    run(["--sync", "--repo", d], { state: data });
    const { out } = run(["--status", "--repo", d], { home });
    expect(out).toContain("last hook:   skipped:no-hook-input");
    expect(out).toContain("data dir:    " + data);
  });

  it("設定が読めなくてもフックの生死は出す", () => {
    const d = repo('{"_comment":"since を書き忘れた"}');
    const { code, out } = run(["--status", "--repo", d]);
    expect(code).toBe(1);
    expect(out).toContain("読めない: since は必須");
    expect(out).toContain("last hook:");
  });

  it("組み込みコマンドと同名のスキルを名指しで警告する", () => {
    const d = repo(MIN);
    mkdirSync(join(d, ".claude/skills/review"), { recursive: true });
    writeFileSync(join(d, ".claude/skills/review/SKILL.md"), "# review");
    expect(run(["--status", "--repo", d]).out).toContain("warning:     組み込みコマンドと同名のため記録されない: review");
  });
});
