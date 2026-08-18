import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import {
  saveCompilerCache,
  validateRestoredCompilerCache,
} from "../src/cache_validation";

jest.mock("@actions/cache");
jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
}));

describe("compiler cache validation", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedExists = fs.existsSync as jest.MockedFunction<
    typeof fs.existsSync
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExists.mockReturnValue(true);
    mockedExec.mockResolvedValue(0);
  });

  it("accepts a complete cache whose compiler runs", async () => {
    await expect(
      validateRestoredCompilerCache("compiler", ["/setup"], "tool", [
        "--version",
      ]),
    ).resolves.toBe(true);
  });

  it("rejects a cache with missing required files without running it", async () => {
    mockedExists.mockReturnValue(false);

    await expect(
      validateRestoredCompilerCache("compiler", ["/setup"], "tool", [
        "--version",
      ]),
    ).resolves.toBe(false);
    expect(mockedExec).not.toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("missing: /setup"),
    );
  });

  it("rejects a cache whose compiler validation fails", async () => {
    mockedExec.mockResolvedValue(1);

    await expect(
      validateRestoredCompilerCache("compiler", ["/setup"], "tool", [
        "--version",
      ]),
    ).resolves.toBe(false);
  });

  it("does not fail an installation when cache saving is unavailable", async () => {
    (
      cache.saveCache as jest.MockedFunction<typeof cache.saveCache>
    ).mockRejectedValue(new Error("immutable cache already exists"));

    await expect(
      saveCompilerCache(["/compiler"], "key"),
    ).resolves.toBeUndefined();
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("immutable cache already exists"),
    );
  });

  describe("save timeout", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it("times out a hanging cache save with a warning instead of blocking", async () => {
      (
        cache.saveCache as jest.MockedFunction<typeof cache.saveCache>
      ).mockImplementation(() => new Promise(() => {}));

      jest.useFakeTimers();
      const savePromise = saveCompilerCache(["/compiler"], "key");

      jest.advanceTimersByTime(10 * 60_000);
      for (let i = 0; i < 10; i++) await Promise.resolve();

      await expect(savePromise).resolves.toBeUndefined();
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("Cache save timed out after 10 minutes"),
      );
    });

    it("clears the timeout once the save completes", async () => {
      (
        cache.saveCache as jest.MockedFunction<typeof cache.saveCache>
      ).mockResolvedValue(1);

      jest.useFakeTimers();
      await saveCompilerCache(["/compiler"], "key");

      // The timer must not fire after a successful save.
      jest.advanceTimersByTime(10 * 60_000);
      for (let i = 0; i < 10; i++) await Promise.resolve();

      expect(core.warning).not.toHaveBeenCalled();
    });

    it("honors a custom timeout", async () => {
      (
        cache.saveCache as jest.MockedFunction<typeof cache.saveCache>
      ).mockImplementation(() => new Promise(() => {}));

      jest.useFakeTimers();
      const savePromise = saveCompilerCache(
        ["/compiler"],
        "key",
        20 * 60_000,
      );

      jest.advanceTimersByTime(10 * 60_000);
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(core.warning).not.toHaveBeenCalled();

      jest.advanceTimersByTime(10 * 60_000);
      for (let i = 0; i < 10; i++) await Promise.resolve();

      await expect(savePromise).resolves.toBeUndefined();
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("Cache save timed out after 20 minutes"),
      );
    });
  });
});
