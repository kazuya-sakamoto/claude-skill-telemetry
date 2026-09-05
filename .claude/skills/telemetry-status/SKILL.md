---
name: telemetry-status
description: このリポジトリのスキル実行ログの状態を確認する。フックが発火しているか、どのスキルにどれだけコストがかかっているかを見たい時に使う。
---

# telemetry-status

自己ホストの確認用。プラグイン本体が自分自身を計測できているかを、このスキルの実行そのもので確かめる。

## 手順

1. `./bin/run --status` — 設定・書き込み先・対象スキル・transcript 本数を出す
2. `./bin/run --dry-run` — 何件が追加/更新されるかを、書き込まずに出す
3. `./bin/run --report` — 記録済みのログを集計する

## 読み方

- `transcripts: 0 本` なら、このリポジトリで Claude Code を起動したセッションがまだ無い
- `--report` が「記録なし」を返すのに `--dry-run` が件数を出すなら、フックが発火していない（`bin/run` の権限か、プラグインが install されていない）
