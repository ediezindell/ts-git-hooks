# TODO

- [ ] Implement glob pattern filtering for running scripts on specific files.
  - Allow users to specify file extensions or glob patterns to determine which scripts to run.
  - This would enable functionality similar to `lint-staged`.
  - Example:
    ```ts
    export const config: TSGitHookConfig = {
      'pre-commit': {
        '*.{js,ts}': ['lint', 'format'],
        '*.{css,scss}': ['stylelint']
      }
    }
    ```