import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, _resetConfig } from "./config";
import { fileExists } from "../utils/fs";

// Mock jiti and fs
vi.mock("../utils/fs");
const mockJitiInstance = vi.fn();
vi.mock("jiti", () => ({
  default: vi.fn(() => mockJitiInstance)
}));

describe("loadConfig validation", () => {
  beforeEach(() => {
    _resetConfig();
    vi.mocked(fileExists).mockResolvedValue(true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockJitiInstance.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should warn when configuration is invalid", async () => {
    // Mock jiti to return an invalid config (e.g., number instead of string for script)
    mockJitiInstance.mockReturnValue({
      config: {
        "pre-commit": 123 // Invalid: should be string, array, or object
      }
    });

    await loadConfig();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid configuration in git-hooks.config.ts:"),
      expect.any(Object)
    );
  });

  it("should NOT warn when configuration is valid", async () => {
    mockJitiInstance.mockReturnValue({
      config: {
        "pre-commit": { "*.ts": "lint" },
        "pre-push": ["test", "build"]
      }
    });

    await loadConfig();

    expect(console.warn).not.toHaveBeenCalled();
  });

  it("should handle hook names in kebab-case and camelCase", async () => {
    mockJitiInstance.mockReturnValue({
      config: {
        "pre-commit": "lint",
        "prePush": "test"
      }
    });

    const config = await loadConfig();

    expect(config).toEqual({
      preCommit: "lint",
      prePush: "test"
    });
    expect(console.warn).not.toHaveBeenCalled();
  });
});
