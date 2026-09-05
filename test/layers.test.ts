import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 設計図はドキュメントに書くと現実とずれても誰も気づかない（実際にずれていた）。
 * ここでは層の地図そのものをテストにして、上向きの import と核への副作用の混入を落とす。
 */
const SRC = join(import.meta.dirname, "../src");

/** 数字が小さいほど内側。import は自分と同じか内側の層にしか向けない。 */
const LAYER: Record<string, number> = {
  schema: 0, // 契約: 読む形と書く形
  scan: 1, // 純粋な核: transcript の列 → LogRecord
  transcript: 2, // 素材: fs/os を触る薄い部品
  config: 2,
  datadir: 2,
  skills: 2,
  identity: 2,
  lock: 2,
  ledger: 3, // 応用: 素材と核を束ねる
  report: 3,
  sync: 3,
  cli: 4, // 入口
};

/** 副作用を持たない核。fixture を渡せば全部テストできる、を守る対象。 */
const PURE = new Set(["schema", "scan"]);

function modules(): string[] {
  return readdirSync(SRC)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.replace(/\.ts$/, ""));
}

function source(name: string): string {
  return readFileSync(join(SRC, `${name}.ts`), "utf8");
}

function localImports(name: string): string[] {
  return [...source(name).matchAll(/from "\.\/([a-z]+)\.js"/g)].map((m) => m[1] as string);
}

/** README が保証している「外向きの出口が無い」の実体。破ると保証が嘘になる。 */
const OUTBOUND = /from "node:(http|https|http2|net|tls|dns|dgram|child_process|worker_threads|cluster)"|\bfetch\(|\bWebSocket\b|\bXMLHttpRequest\b|\brequire\(|\bimport\(/;

describe("外向きの出口が存在しない", () => {
  it("src のどのモジュールもネットワークと子プロセスに触れない", () => {
    for (const name of modules()) {
      expect(source(name), `${name}`).not.toMatch(OUTBOUND);
    }
  });

  it("バンドル済みの dist にもネットワーク API が入っていない", () => {
    const dist = readFileSync(join(import.meta.dirname, "../dist/cli.js"), "utf8");
    expect(dist).not.toMatch(OUTBOUND);
  });

  it("実行時依存を持たない（供給網から経路が生えない）", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});

describe("レイヤー", () => {
  it("src の全モジュールが層の地図に載っている", () => {
    expect(modules().sort()).toEqual(Object.keys(LAYER).sort());
  });

  it("import は内側にしか向かない", () => {
    for (const [name, layer] of Object.entries(LAYER)) {
      for (const dep of localImports(name)) {
        expect(LAYER[dep], `${name} → ${dep} が上向き`).toBeLessThanOrEqual(layer);
      }
    }
  });

  it("純粋な核は副作用を持ち込まない", () => {
    for (const name of PURE) {
      const s = source(name);
      expect(s, `${name}: fs/os 系の import`).not.toMatch(/from "node:(fs|os|child_process|worker_threads)"/);
      // new Date(文字列) は変換なので許す。引数なしの時計読みだけ落とす。
      expect(s, `${name}: 時計読み`).not.toMatch(/new Date\(\)|Date\.now\(\)/);
      expect(s, `${name}: プロセス環境への依存`).not.toMatch(/process\.(env|argv|cwd|stdin|stdout)/);
      for (const dep of localImports(name)) {
        expect(PURE.has(dep), `${name} → ${dep}（純粋でないモジュール）`).toBe(true);
      }
    }
  });
});
