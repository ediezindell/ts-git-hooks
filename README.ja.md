# ts-git-hooks

TypeScript ファーストで、型安全な Git フックマネージャー。

[English](README.md) | [日本語](README.ja.md)

## ts-git-hooks を選ぶ理由

-   **型安全**: `package.json` のスクリプト名に対して自動補完が効きます。
-   **柔軟な設定**: ファイルベースのフック（`pre-commit`）には glob パターンを使用し、一般的なフック（`pre-push`）にはシンプルなスクリプト指定が可能です。
-   **TypeScript ファースト**: `.ts` で設定を書くため、完全な IDE サポートが得られます。
-   **依存関係ゼロ**: `ts-git-hooks` はランタイム依存関係を持たないスタンドアロンツールです。

## コアコンセプト

`ts-git-hooks` は、Git フックの管理をシンプルかつ堅牢にするためのいくつかの重要な原則に基づいて構築されています。

1.  **型安全なスクリプト:** TypeScript を活用することで、`package.json` の npm スクリプト名に対して完全な自動補完とコンパイル時の安全性を提供します。タイプミスや推測作業はもう必要ありません。

2.  **Glob ベースのターゲット指定:** glob パターンを使用して、どのファイルに対してどのスクリプトを実行するかを正確に制御できます。たとえば、`'*.ts'` に対するスクリプトは、ステージングされた TypeScript ファイルに対してのみ実行されます。

3.  **柔軟な引数処理:** スクリプトは、マッチした**ステージングされたファイル**のリストを自動的に引数として受け取ります。より複雑な要件がある場合は、スクリプトが必要とする形式に引数を整形する関数を提供できます。

4.  **npm への最適化:** ワークフロー全体が既存の npm スクリプトとシームレスに統合されるように設計されており、既に使用しているツールのための強力で型安全なオーケストレーターとして機能します。

## インストール

```bash
npm install -D ts-git-hooks
```

## クイックスタート

### 1. 設定ファイルの作成

`init` コマンドを実行して、プロジェクトのルートに `git-hooks.config.ts` ファイルを作成します。

```bash
npx ts-git-hooks init
```

これにより、デフォルト設定と、`package.json` のスクリプトに対する型定義を含む `git-hooks.d.ts` ファイルが生成されます。

### 2. フックのインストール

```bash
npx ts-git-hooks install
```

これで完了です！ Git フックが有効になりました。

## 設定

`git-hooks.config.ts` ファイルは `ts-git-hooks` の中心となる設定ファイルです。これは TypeScript ファイルであり、各 Git フックに対して実行するスクリプトを定義します。

フックの設定には主に2つのタイプがあります。

### 1. Glob ベースのフック (`pre-commit`)

`pre-commit` のように、特定のファイル群に対して操作を行うフックの場合、Glob ベースの設定を使用できます。キーは glob パターンで、値はそのパターンに一致するファイルに対して実行するスクリプトです。

```ts
// git-hooks.config.ts
import type { TSGitHookConfig } from 'ts-git-hooks';

type Scripts = keyof typeof import('./package.json')['scripts'];

export const config: TSGitHookConfig<Scripts> = {
  'pre-commit': {
    '*.ts': 'lint', // ステージングされた .ts ファイルに対して 'lint' スクリプトを実行
    '*.{md,json}': 'format', // ステージングされた .md および .json ファイルに対して 'format' スクリプトを実行
  },
};
```

### 2. シンプルなフック (例: `pre-push`, `commit-msg`)

特定のファイルではなくプロジェクト全体に対してタスクを実行するフックの場合、スクリプト名、またはスクリプト名の配列を指定できます。これらのスクリプトは並列に実行されます。

```ts
// git-hooks.config.ts
export const config: TSGitHookConfig<"test" | "build"> = {
  'pre-push': ['test', 'build'] // プッシュする前に 'test' と 'build' スクリプトを実行
};
```

### 上級編: カスタム引数フォーマット

デフォルトでは、Glob ベースのフックの場合、マッチしてステージングされたファイルのパスがスペース区切りの引数としてスクリプトに追加されます。これをカスタマイズするには、`[script, argsFn]` のタプルを指定します。ここで `argsFn` は、ステージングされたファイルとスクリプト名を受け取り、引数文字列を返す関数です。

```ts
// git-hooks.config.ts
export const config: TSGitHookConfig<"lint"> = {
  'pre-commit': {
    '*.ts': ['lint', (files) => files.map(f => `--file ${f}`).join(' ')],
  },
};
```

## サポートされているフック

すべての標準的な Git フックがサポートされています。設定ファイルでは、キャメルケース (`preCommit`) とケバブケース (`pre-commit`) の両方がサポートされています。

## CLI コマンド

-   `npx ts-git-hooks init`: デフォルトの設定ファイルを作成し、スクリプトの型を同期します。
-   `npx ts-git-hooks sync`: `package.json` からスクリプトの型定義を更新します。
-   `npx ts-git-hooks install`: 設定に基づいて Git フックを `.git/hooks` ディレクトリにインストールします。
-   `npx ts-git-hooks uninstall`: フックを削除します。
-   `npx ts-git-hooks list`: 設定されているフックとスクリプトを一覧表示します。
-   `npx ts-git-hooks run <hook>`: 特定のフックのスクリプトを実行します (内部使用向け)。

## 仕組み

-   Glob ベースの設定の場合、一致するパターンごとにスクリプトがデフォルトで並列実行されます。
-   直接的なスクリプト設定の場合、配列内のスクリプトがデフォルトで並列実行されます。
-   いずれかのスクリプトが失敗した場合、フックは失敗し、Git 操作は中止されます。

## 直列実行 (Sequential Execution)

デフォルトでは、`ts-git-hooks` はパフォーマンス向上のために複数のスクリプトを並列に実行します。しかし、同じファイルを修正する複数のツール（例: `eslint --fix` と `prettier --write`）がある場合、並列実行は競合やファイルの破損を引き起こす可能性があります。

スクリプトをグローバル、または特定のフックごとに直列に実行するように強制できます。

### グローバルでの直列実行

```ts
export const config: TSGitHookConfig = {
  sequential: true, // すべてのフックがスクリプトを直列に実行します
  'pre-commit': {
    '*.ts': ['eslint --fix', 'prettier --write'],
  },
};
```

### フック単位での直列実行

```ts
export const config: TSGitHookConfig = {
  'pre-commit': {
    sequential: true, // pre-commit のスクリプトのみが直列に実行されます
    config: {
      '*.ts': ['eslint --fix', 'prettier --write'],
    },
  },
};
```

## Tips & トラブルシューティング

### 「ファイルが処理されなかった」エラーの回避 (Biome, ESLint など)

**Biome** や **ESLint** などのツールは、引数として渡されたファイルが最終的にそれ自体の設定（`biome.json` など）で無視対象になっている場合、非ゼロの終了コード（エラー）を返すことがあります。これが原因で Git フックが失敗するのを防ぐには、各ツールの適切なフラグを使用してください。

- **Biome**: `--no-errors-on-unmatched` を使用します。
- **ESLint**: `--no-error-on-unmatched-pattern` を使用します。

## ライセンス

MIT
