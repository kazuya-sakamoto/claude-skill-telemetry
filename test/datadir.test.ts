import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir, dataDirs, repoKey } from "../src/datadir.js";

const dirs: string[] = [];

function home(plugins: string[] = []): string {
  const d = mkdtempSync(join(tmpdir(), "cst-home-"));
  dirs.push(d);
  const root = join(d, ".claude", "plugins", "data");
  for (const [i, name] of plugins.entries()) {
    const p = join(root, name);
    mkdirSync(p, { recursive: true });
    // 新しい順に返ることを確かめたいので、mtime を配列の順序どおりにずらす。
    utimesSync(p, new Date(1000 + i), new Date(1000 + i));
  }
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("状態の置き場", () => {
  it("CLAUDE_PLUGIN_DATA があればそこだけを使う", () => {
    expect(dataDirs({ CLAUDE_PLUGIN_DATA: "/x/y" }, home(["claude-skill-telemetry"]))).toEqual(["/x/y"]);
  });

  it("env が無ければ実際の置き場を探す（手動実行がフックと同じ場所を見るため）", () => {
    const h = home(["claude-skill-telemetry-inline"]);
    expect(dataDirs({}, h)).toEqual([join(h, ".claude/plugins/data/claude-skill-telemetry-inline")]);
  });

  it("install 版と --plugin-dir 版が両方あれば新しい順に返す", () => {
    const h = home(["claude-skill-telemetry", "claude-skill-telemetry-inline"]);
    expect(dataDirs({}, h).map((p) => p.split("/").pop())).toEqual([
      "claude-skill-telemetry-inline",
      "claude-skill-telemetry",
    ]);
  });

  it("他のプラグインのデータ領域は混ぜない", () => {
    const h = home(["gitkraken-hooks-gitkraken", "claude-skill-telemetry"]);
    expect(dataDirs({}, h).map((p) => p.split("/").pop())).toEqual(["claude-skill-telemetry"]);
  });

  it("どこにも無ければ tmpdir に落とす（書き込み先は必ず 1 つ決まる）", () => {
    expect(dataDir({}, home())).toBe(join(tmpdir(), "claude-skill-telemetry"));
  });

  it("repoKey は repo ごとに違い、パスそのものは含まない", () => {
    expect(repoKey("/a")).toMatch(/^[0-9a-f]{16}$/);
    expect(repoKey("/a")).not.toBe(repoKey("/b"));
  });
});
