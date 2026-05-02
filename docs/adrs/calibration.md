# ADR キャリブレーション履歴

ADR の判断・前提に対する差し戻し記録。`/adr-calibrate` の入力。

---

### [2026-05-03] ADR-0001 の前提誤り → ABANDONED

- **状況**: 「`defineConfig()` wrapper + `KnownScripts` module augmentation で TypeScript-first の ergonomics を上げる」という ADR を作成し、user 承認を得て実装まで進めた。実装後、user から「そもそもジェネリクスは自動生成されるからユーザーが書くわけじゃない」「PackageScripts も書かない」と二段階で前提を否定された。
- **実際の判断**: 「user が `TSGitHookConfig<PackageScripts>` の generic を手書きする必要がある → ergonomics 改善余地あり」と framing
- **期待された判断**: `init` の default template は `TSGitHookConfig`（generic なし）で、`<PackageScripts>` は opt-in のコメント例。この project の type-safety の主軸は **config 構造の型**（hook 名 / sequential / glob 形式 / args function signature）であり、script 名の string validation ではない。「ergonomics 問題」は存在していなかった。
- **差し戻し理由**:
  1. `init.ts:9-24` の default template を読めば「generic なし」が default だと分かるのに、private な README 記述と `init.ts:14` のコメント例だけを見て「user が書く前提」と誤読した
  2. 同じ project の他の ADR や design doc を読まずに「TypeScript-first」という宣伝コピーから ergonomics 改善ニーズを逆算してしまった
  3. 実装中に「runtime entry が無い」という hidden complexity が surface し、library bundle build + `package.json` `main`/`exports` 追加という別 PR レベルのスコープ拡張（ADR-0002 案）が発生。元の改善幅と釣り合わない兆候を見落とした
- **反映先**: 自分の design proposal の出し方
- **更新内容**:
  - 「現状の不便さ」を主張する前に、対象ファイル（特に init template / default 値）を読み、**default 体験で何が困るのか**を具体例で示せるか自問する
  - 「業界慣行と揃わない」「他の TS-first tool に劣る」のような相対比較で価値を framing するときは、**absolute value（user の actual pain point）** を別途提示できるか確認する。比較だけで済ませると「揃ってないが現状で誰も困っていない」case を見落とす
  - design proposal が build infra や package metadata に波及する兆候（runtime import が必要、新たな build target が必要、等）を発見した時点で、**スコープを縮小するか中止するかを user に問う**。承認済み ADR を「成立させるため」と理由付けして勝手に拡張しない
  - assumption-check skill を design proposal の前に必ず通す。立場・経緯・既往・目的のいずれかが不明なら長文 ADR を書く前に短い質問で確認する
