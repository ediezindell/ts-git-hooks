# AGENTS.md

This file contains guidelines for agentic coding agents working on the ts-git-hooks codebase.

## Project Overview

ts-git-hooks is a TypeScript-first git hooks manager with type-safe configuration. It provides a CLI tool that manages git hooks with full TypeScript support and type safety.

## Development Commands

### Essential Commands
- `npm run build` - Compile TypeScript to JavaScript in dist/
- `npm run test` - Run all tests using Vitest
- `npm run test -- <test-file>` - Run a specific test file (e.g., `npm run test -- src/utils/git.test.ts`)
- `npm run lint` - Lint code using Biome
- `npm run format` - Format code using Biome
- `npm run check` - Run Biome check with auto-fix
- `npm run typecheck` - Run TypeScript compiler check using tsgo

### Testing Guidelines
- Tests are written using Vitest
- Test files should be co-located with source files (`.test.ts` suffix)
- Use vi.mock() for mocking dependencies
- Use beforeEach/afterEach hooks to reset mocks
- Test both success and error paths
- Follow the existing test patterns in the codebase

## Code Style Guidelines

### Imports
- Use `node:` prefix for Node.js built-in modules
- Group imports: external libraries first, then internal modules, then type imports
- Use type-only imports where possible (`import type`)
- Example:
  ```typescript
  import { spawn } from "node:child_process";
  import { mkdir, readdir } from "node:fs/promises";
  import type { Options } from "micromatch";
  import type { HookConfig } from "../types";
  import { logger } from "../utils/logger";
  ```

### Naming Conventions
- **Functions**: camelCase with descriptive names
- **Variables**: camelCase, prefer descriptive over abbreviated
- **Constants**: UPPER_SNAKE_CASE for top-level constants
- **Types**: PascalCase with descriptive names
- **Files**: kebab-case for utilities, PascalCase for components (if any)
- **Directories**: kebab-case

### Error Handling
- Use async/await with try/catch for async operations
- Log errors using the custom logger (from `../utils/logger`)
- Provide meaningful error messages that include context
- Always handle both stdout and stderr from external processes
- Use Promise-based error handling with reject/resolve patterns

### TypeScript Guidelines
- Use strict type checking (enforced in tsconfig)
- Provide JSDoc comments for public APIs and complex functions
- Use union types for enumerations (see types.ts for examples)
- Leverage type inference but be explicit when it improves readability
- Use generics for type-safe, reusable functions

### Function Patterns
- Keep functions small and focused on a single responsibility
- Use arrow functions consistently
- Add JSDoc comments explaining purpose, parameters, and return values
- Use consistent parameter ordering (data first, options last)

### File Structure
- `src/types.ts` - Central type definitions
- `src/utils/` - Utility functions with co-located tests
- `src/core/` - Core business logic (runner, config)
- `src/commands/` - CLI command implementations
- `src/cli/` - CLI entry point

## Specific Patterns

### Git Command Execution
- Use the `execGit` function from utils/git.ts for all git operations
- Handle multi-byte characters correctly using StringDecoder
- Log full command and output on failure
- Use spawn() directly instead of shell execution to avoid shell injection

### Mocking in Tests
- Mock all external dependencies (fs, child_process, etc.)
- Create helper functions for complex mock setups
- Use vi.mocked() for type-safe mock assertions
- Reset mocks in afterEach hooks

### Logger Usage
- Import logger from `../utils/logger`
- Use appropriate log levels: `log()`, `info()`, `success()`, `warn()`, `error()`
- Include context in log messages
- Handle Error objects correctly in error logging

### Configuration Patterns
- Load configuration using `loadConfig()` from core/config.ts
- Support both kebab-case and camelCase hook names
- Use type generics for script name type safety
- Handle missing config files gracefully

## Performance Considerations
- Cache micromatch imports when used repeatedly
- Use Set for O(1) lookups instead of Array.includes()
- Avoid unnecessary file system operations
- Batch git operations where possible
- Use spawn instead of shell execution for better performance and security

## Build System
- Uses CommonJS modules (`"type": "commonjs"` in package.json)
- TypeScript compilation outputs to `dist/` directory
- CLI entry point is `dist/cli/index.js`
- Build runs automatically on `npm install` (prepare script)

## Common Gotchas
- This project uses TypeScript native preview features
- Test mocking requires careful handling of Node.js built-in modules
- Git commands may produce multi-byte output that needs special handling
- Some git hooks (like commit-msg) skip stash operations
- Always check both staged and changed files for pre-commit hooks

## Code Quality Standards
- All code must pass Biome linting and formatting
- All tests must pass before committing
- Type checking with tsgo must pass
- Maintain 100% test coverage for critical paths
- Use descriptive commit messages following conventional commit format