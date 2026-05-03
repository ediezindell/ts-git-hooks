import { quote as shellQuote } from "shell-quote";

/**
 * Shell-quotes a list of strings (typically file paths) into a single
 * space-separated string that is safe to embed in a command line passed to a
 * shell.
 *
 * Use this when an `argsFn` (the second element of a `[script, argsFn]`
 * tuple) returns a string that contains shell operators (`&&`, `||`, `;`,
 * `|`, redirects). In that case the result is executed via `shell: true`,
 * and unquoted special characters in file names would be interpreted by the
 * shell.
 *
 * @example
 * import { quote } from 'ts-git-hooks';
 * const config = {
 *   'pre-commit': {
 *     '*.ts': ['lint', (files) => `lint ${quote(files)} && echo done`],
 *   },
 * };
 */
export const quote = (parts: string[]): string => shellQuote(parts);
