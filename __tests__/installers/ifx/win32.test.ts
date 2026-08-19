import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as tc from "@actions/tool-cache";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { installWin32 } from "../../../src/installers/ifx/win32";
import { Arch, Compiler, OS, Msystem, type Inputs } from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/cache");
jest.mock("@actions/tool-cache");
jest.mock("../../../src/verify_download");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  writeFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  rmSync: jest.fn(),
}));
jest.mock("os");

describe("installWin32 (ifx)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedRestoreCache = cache.restoreCache as jest.MockedFunction<
    typeof cache.restoreCache
  >;
  const mockedDownloadTool = tc.downloadTool as jest.MockedFunction<
    typeof tc.downloadTool
  >;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedOs = os as jest.Mocked<typeof os>;

  const baseInputs: Inputs = {
    compiler: Compiler.IFX,
    version: "2026.0.0",
    os: OS.Windows,
    osVersion: "10.0.19045",
    arch: Arch.X64,
    cleanupDisk: false,
    updateEnvironment: true,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
    mockedOs.tmpdir.mockReturnValue("C:\\Temp");
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "ifx") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("ifx version 2026.0.0"));
        }
      } else if (commandLine === "cmd" && args?.[0] === "/C") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("PATH=C:\\bin\nINTEL_VAR=foo"));
        }
      }
      return 0;
    });
  });

  it("restores from cache if available", async () => {
    mockedRestoreCache.mockResolvedValue("cache-hit");

    const result = await installWin32(baseInputs);

    expect(result.fc).toBe("ifx");
    expect(result.cc).toBe("cl");
    expect(result.cxx).toBe("cl");

    expect(mockedRestoreCache).toHaveBeenCalled();
    expect(mockedDownloadTool).not.toHaveBeenCalled();
  });

  it("downloads and installs if not in cache", async () => {
    mockedRestoreCache.mockResolvedValue(undefined);
    mockedDownloadTool.mockResolvedValue("C:\\Temp\\installer.exe");

    await installWin32(baseInputs);

    expect(mockedDownloadTool).toHaveBeenCalled();
    expect(mockedExec).toHaveBeenCalledWith(
      '"C:\\Temp\\installer.exe"',
      expect.arrayContaining(["-s", "-a", "--silent", "--eula", "accept"]),
      { ignoreReturnCode: true },
    );
    expect(cache.saveCache).toHaveBeenCalled();
  });

  it("retries installation on crash and eventually succeeds", async () => {
    mockedRestoreCache.mockResolvedValue(undefined);
    mockedDownloadTool.mockResolvedValue("C:\\Temp\\installer.exe");

    let attempts = 0;
    mockedExec.mockImplementation(async (cmd) => {
      if (cmd === '"C:\\Temp\\installer.exe"') {
        attempts++;
        if (attempts === 1) return 1;
      }
      if (cmd === "ifx") return 0;
      if (cmd === "cmd") return 0;
      return 0;
    });

    jest.useFakeTimers();
    const installPromise = installWin32(baseInputs);

    // Flush microtasks
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Advance past 15s delay
    jest.advanceTimersByTime(15000);

    // Flush microtasks
    for (let i = 0; i < 10; i++) await Promise.resolve();

    await installPromise;
    jest.useRealTimers();

    expect(attempts).toBe(2);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining(
        "Installer crashed with exit code 1 (attempt 1/3)",
      ),
    );
  });

  describe("download retry", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it("retries a failed download, removes the partial file, and succeeds", async () => {
      mockedRestoreCache.mockResolvedValue(undefined);
      mockedDownloadTool
        .mockRejectedValueOnce(new Error("connection reset"))
        .mockResolvedValue("C:\\Temp\\installer.exe");

      jest.useFakeTimers();
      const installPromise = installWin32(baseInputs);

      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(mockedDownloadTool).toHaveBeenCalledTimes(1);

      // Advance past the 20s backoff after the first failure.
      jest.advanceTimersByTime(20_000);
      for (let i = 0; i < 10; i++) await Promise.resolve();

      await installPromise;

      expect(mockedDownloadTool).toHaveBeenCalledTimes(2);
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("Download failed (attempt 1/3)"),
      );
      // The partial download must not be treated as a complete installer.
      expect(mockedFs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining("ifx-2026.0.0.exe"),
        { force: true },
      );
      expect(core.info).toHaveBeenCalledWith("Verifying installer...");
      expect(cache.saveCache).toHaveBeenCalled();
    });

    it("gives up after three attempts and propagates the last error", async () => {
      mockedRestoreCache.mockResolvedValue(undefined);
      mockedDownloadTool.mockRejectedValue(new Error("network down"));

      jest.useFakeTimers();
      const installPromise = installWin32(baseInputs);

      for (let i = 0; i < 10; i++) await Promise.resolve();
      jest.advanceTimersByTime(20_000); // backoff after attempt 1
      for (let i = 0; i < 10; i++) await Promise.resolve();
      jest.advanceTimersByTime(40_000); // backoff after attempt 2
      for (let i = 0; i < 10; i++) await Promise.resolve();

      await expect(installPromise).rejects.toThrow("network down");

      expect(mockedDownloadTool).toHaveBeenCalledTimes(3);
      expect(mockedFs.rmSync).toHaveBeenCalledTimes(3);
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("Download failed (attempt 1/3)"),
      );
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("Download failed (attempt 2/3)"),
      );
      expect(core.info).not.toHaveBeenCalledWith("Verifying installer...");
    });
  });

  it("skips installation if exit code is 1001 (already installed)", async () => {
    mockedRestoreCache.mockResolvedValue(undefined);
    mockedDownloadTool.mockResolvedValue("C:\\Temp\\installer.exe");

    let installerCalls = 0;
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === '"C:\\Temp\\installer.exe"') {
        installerCalls++;
        return 1001;
      } else if (commandLine === "ifx") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("ifx version 2026.0.0"));
        }
      } else if (commandLine === "cmd" && args?.[0] === "/C") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("PATH=C:\\bin\nINTEL_VAR=foo"));
        }
      }
      return 0;
    });

    await installWin32(baseInputs);

    expect(installerCalls).toBe(1);
    expect(core.info).toHaveBeenCalledWith(
      "Intel oneAPI is already installed, skipping.",
    );
  });

  it("resolves 2025.3 to 2025.3.3 using resolveMinorToLatestPatch", async () => {
    mockedRestoreCache.mockResolvedValue("cache-hit");
    const inputs = { ...baseInputs, version: "2025.3" };
    await installWin32(inputs);

    expect(mockedRestoreCache).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("ifx-win32-validated-v1-x64-2025.3.3"),
    );
  });

  it("exports environment variables from setvars", async () => {
    mockedRestoreCache.mockResolvedValue("cache-hit");

    await installWin32(baseInputs);

    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("setvars_and_dump.bat"),
      expect.stringContaining("setvars.bat"),
    );
    expect(core.exportVariable).toHaveBeenCalledWith("PATH", "C:\\bin");
    expect(core.exportVariable).toHaveBeenCalledWith("INTEL_VAR", "foo");
  });

  it("resolves intel 2023.0 to the restored 2023.0.0 release", async () => {
    mockedRestoreCache.mockResolvedValue("cache-hit");
    const inputs = { ...baseInputs, version: "2023.0" };

    await installWin32(inputs);

    expect(mockedRestoreCache).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("ifx-win32-validated-v1-x64-2023.0.0"),
    );
  });
});
