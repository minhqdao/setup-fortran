import {
  resolveVersion,
  resolveWindowsVersion,
  resolveLatestPatch,
  verifyAssetExists,
} from "../src/resolve_version";
import { Arch, Compiler, LATEST, OS, Msystem } from "../src/types";
import type { Target } from "../src/types";
import * as core from "@actions/core";

jest.mock("@actions/core");

const baseTarget: Target = {
  compiler: Compiler.GFortran,
  version: LATEST,
  os: OS.Linux,
  osVersion: "22.04",
  arch: Arch.X64,
  msystem: Msystem.Native,
};

const SUPPORTED: Record<string, readonly string[]> = {
  [Arch.X64]: ["15", "14", "13"],
  [Arch.ARM64]: ["14", "13"],
};

describe("resolveVersion", () => {
  beforeAll(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ tag_name: "llvmorg-19.1.7", prerelease: false }],
    } as unknown as Response);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe("when version is LATEST", () => {
    it("returns the first entry for x64", () => {
      const result = resolveVersion(baseTarget, SUPPORTED);
      expect(result).toBe("15");
    });

    it("returns the first entry for arm64", () => {
      const target: Target = { ...baseTarget, arch: Arch.ARM64 };
      const result = resolveVersion(target, SUPPORTED);
      expect(result).toBe("14");
    });
  });

  describe("when a specific version is requested", () => {
    it("returns the version if it is supported", () => {
      const target: Target = { ...baseTarget, version: "14" };
      const result = resolveVersion(target, SUPPORTED);
      expect(result).toBe("14");
    });

    it("handles 2-part versions like 24.1 if present in supported list", () => {
      const target: Target = { ...baseTarget, version: "24.1" };
      const supported = { [Arch.X64]: ["24.3", "24.1"] };
      const result = resolveVersion(target, supported);
      expect(result).toBe("24.1");
    });

    it("throws if the version is not supported on this arch", () => {
      const target: Target = { ...baseTarget, arch: Arch.ARM64, version: "15" };
      expect(() => resolveVersion(target, SUPPORTED)).toThrow(
        "gfortran 15 is not supported on linux (arm64). Supported versions: 14, 13",
      );
    });

    it("throws if the version is not supported on any arch", () => {
      const target: Target = { ...baseTarget, version: "9" };
      expect(() => resolveVersion(target, SUPPORTED)).toThrow(
        "gfortran 9 is not supported on linux (x64). Supported versions: 15, 14, 13",
      );
    });
  });

  describe("resolveMinorToLatestPatch", () => {
    const supported = {
      [Arch.X64]: ["2025.2.1", "2025.2.0", "2025.1.0", "2024.0.0"],
    };

    it("resolves YYYY.minor to the latest patch if resolveMinorToLatestPatch is true", () => {
      const target: Target = { ...baseTarget, version: "2025.2" };
      const result = resolveVersion(target, supported, {
        resolveMinorToLatestPatch: true,
      });
      expect(result).toBe("2025.2.1");
    });

    it("does nothing if resolveMinorToLatestPatch is false", () => {
      const target: Target = { ...baseTarget, version: "2025.2" };
      expect(() =>
        resolveVersion(target, supported, {
          resolveMinorToLatestPatch: false,
        }),
      ).toThrow("gfortran 2025.2 is not supported on linux (x64)");
    });

    it("returns the exact version if it exists in the list even if resolveMinorToLatestPatch is true", () => {
      const target: Target = { ...baseTarget, version: "2025.1.0" };
      const result = resolveVersion(target, supported, {
        resolveMinorToLatestPatch: true,
      });
      expect(result).toBe("2025.1.0");
    });

    it("throws if no version starts with the prefix", () => {
      const target: Target = { ...baseTarget, version: "2025.3" };
      expect(() =>
        resolveVersion(target, supported, {
          resolveMinorToLatestPatch: true,
        }),
      ).toThrow("gfortran 2025.3 is not supported on linux (x64)");
    });

    it("only matches YYYY.minor format", () => {
      const target: Target = { ...baseTarget, version: "2025" };
      expect(() =>
        resolveVersion(target, supported, {
          resolveMinorToLatestPatch: true,
        }),
      ).toThrow("gfortran 2025 is not supported on linux (x64)");
    });

    it("does not match versions with more than two parts as YYYY.minor", () => {
      const target: Target = { ...baseTarget, version: "2025.2.1" };
      const result = resolveVersion(target, supported, {
        resolveMinorToLatestPatch: true,
      });
      expect(result).toBe("2025.2.1");
    });

    it("does not match non-numeric versions", () => {
      const target: Target = { ...baseTarget, version: "abcd.ef" };
      expect(() =>
        resolveVersion(target, supported, {
          resolveMinorToLatestPatch: true,
        }),
      ).toThrow("gfortran abcd.ef is not supported on linux (x64)");
    });

    it("resolves to the first matching entry (latest patch) even if multiple patches exist", () => {
      const manyPatches = {
        [Arch.X64]: ["2025.2.2", "2025.2.1", "2025.2.0"],
      };
      const target: Target = { ...baseTarget, version: "2025.2" };
      const result = resolveVersion(target, manyPatches, {
        resolveMinorToLatestPatch: true,
      });
      expect(result).toBe("2025.2.2");
    });

    it("handles an empty version list with the flag enabled", () => {
      const emptyList = { [Arch.X64]: [] };
      const target: Target = { ...baseTarget, version: "2025.2" };
      expect(() =>
        resolveVersion(target, emptyList, {
          resolveMinorToLatestPatch: true,
        }),
      ).toThrow("gfortran 2025.2 is not supported on linux (x64)");
    });
  });

  describe("when the arch has no supported versions", () => {
    it("throws a no supported versions error for LATEST", () => {
      const emptySupported: Record<string, readonly string[]> = {
        [Arch.X64]: [],
        [Arch.ARM64]: [],
      };
      expect(() => resolveVersion(baseTarget, emptySupported)).toThrow(
        "No supported versions found for gfortran on linux (x64).",
      );
    });

    it("throws if arch is entirely missing from supportedVersions", () => {
      const x64Only: Record<string, readonly string[]> = {
        [Arch.X64]: ["15", "14"],
      };
      const target: Target = { ...baseTarget, arch: Arch.ARM64 };
      expect(() => resolveVersion(target, x64Only)).toThrow(
        "No supported versions found for gfortran on linux (arm64).",
      );
    });
  });

  describe("error messages", () => {
    it("uses the correct compiler name in errors", () => {
      const target: Target = {
        ...baseTarget,
        compiler: Compiler.IFX,
        version: "2024.0.0",
      };
      const supported: Record<string, readonly string[]> = {
        [Arch.X64]: ["2024.1", "2023.2"],
      };
      expect(() => resolveVersion(target, supported)).toThrow(
        "ifx 2024.0.0 is not supported on linux (x64). Supported versions: 2024.1, 2023.2",
      );
    });
  });
});

describe("resolveWindowsVersion", () => {
  const winTarget: Target = {
    ...baseTarget,
    os: OS.Windows,
  };

  const SUPPORTED_WIN: Record<
    string,
    Record<Msystem, readonly string[] | undefined>
  > = {
    [Arch.X64]: {
      [Msystem.Native]: ["15", "14"],
      [Msystem.UCRT64]: ["14", "13"],
      [Msystem.Clang64]: undefined,
    },
    [Arch.ARM64]: {
      [Msystem.Native]: ["14"],
      [Msystem.UCRT64]: undefined,
      [Msystem.Clang64]: undefined,
    },
  };

  it("resolves LATEST for a specific msystem", () => {
    const target = { ...winTarget, msystem: Msystem.UCRT64 };
    const result = resolveWindowsVersion(target, SUPPORTED_WIN);
    expect(result).toBe("14");
  });

  it("resolves a specific version for a specific msystem", () => {
    const target = {
      ...winTarget,
      msystem: Msystem.Native,
      version: "14",
    };
    const result = resolveWindowsVersion(target, SUPPORTED_WIN);
    expect(result).toBe("14");
  });

  it("throws if the environment is not supported for that architecture", () => {
    const target = {
      ...winTarget,
      msystem: Msystem.UCRT64,
      arch: Arch.ARM64,
    };
    expect(() => resolveWindowsVersion(target, SUPPORTED_WIN)).toThrow(
      'The environment "ucrt64" is not supported or implemented for Windows arm64.',
    );
  });

  it("throws if the version is not supported for that msystem", () => {
    const target = {
      ...winTarget,
      msystem: Msystem.UCRT64,
      version: "15",
    };
    expect(() => resolveWindowsVersion(target, SUPPORTED_WIN)).toThrow(
      "gfortran 15 is not supported on win32 (x64). Supported versions: 14, 13",
    );
  });

  it("throws if arch is missing", () => {
    const target = { ...winTarget, arch: "ppc64" as any };
    expect(() => resolveWindowsVersion(target, SUPPORTED_WIN)).toThrow(
      'Architecture "ppc64" is not supported for gfortran on Windows.',
    );
  });

  it("handles resolveMinorToLatestPatch", () => {
    const supported: Record<
      string,
      Record<Msystem, readonly string[] | undefined>
    > = {
      [Arch.X64]: {
        [Msystem.Native]: ["2025.1.1", "2025.1.0"],
        [Msystem.UCRT64]: undefined,
        [Msystem.Clang64]: undefined,
      },
    };
    const target = {
      ...winTarget,
      msystem: Msystem.Native,
      version: "2025.1",
    };
    const result = resolveWindowsVersion(target, supported, {
      resolveMinorToLatestPatch: true,
    });
    expect(result).toBe("2025.1.1");
  });
});

describe("resolveLatestPatch", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Fresh mock for each test to avoid interference
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("resolves version successfully on the first attempt", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ tag_name: "llvmorg-19.1.7", prerelease: false }],
    });

    const result = await resolveLatestPatch("llvm/llvm-project", "19");
    expect(result).toBe("19.1.7");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on HTTP error and eventually succeeds", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ tag_name: "llvmorg-19.1.7", prerelease: false }],
      });

    const promise = resolveLatestPatch("llvm/llvm-project", "19");
    
    // Flush microtasks to ensure fetch is called and we reach the backoff wait
    await Promise.resolve();
    await Promise.resolve();

    // Attempt 1 fails. Backoff is 1000 * 2^(1+1) = 4000ms.
    await jest.advanceTimersByTimeAsync(4000);

    const result = await promise;
    expect(result).toBe("19.1.7");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Network error encountered (HTTP 500: Internal Server Error)"),
    );
  });

  it("retries on timeout and eventually succeeds", async () => {
    const mockFetch = global.fetch as jest.Mock;
    
    // Attempt 1: hangs until aborted
    mockFetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      if (options.signal) {
        options.signal.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      }
    }));
    
    // Attempt 2: succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ tag_name: "llvmorg-19.1.7", prerelease: false }],
    });

    const promise = resolveLatestPatch("llvm/llvm-project", "19");

    await Promise.resolve();
    await Promise.resolve();

    // 1. Trigger timeout (5000ms)
    await jest.advanceTimersByTimeAsync(5000);
    
    await Promise.resolve();
    await Promise.resolve();

    // 2. Trigger backoff (4000ms)
    await jest.advanceTimersByTimeAsync(4000);

    const result = await promise;
    expect(result).toBe("19.1.7");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Network error encountered (Request or body streaming timed out after 5000ms)"),
    );
  });

  it("throws error after exhausting all retries", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
    });

    const promise = resolveLatestPatch("llvm/llvm-project", "19");
    // Ensure we don't get unhandled rejection during timer advancement
    promise.catch(() => {});

    await Promise.resolve();
    await Promise.resolve();

    // Attempt 1 fails, backoff 4000ms
    await jest.advanceTimersByTimeAsync(4000);
    
    await Promise.resolve();
    await Promise.resolve();

    // Attempt 2 fails, backoff 8000ms
    await jest.advanceTimersByTimeAsync(8000);
    
    await Promise.resolve();
    await Promise.resolve();

    // Attempt 3 fails.
    await expect(promise).rejects.toThrow("Request failed after 3 attempts");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("respects custom tagPrefix and tagStripper", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ tag_name: "v1.2.3", prerelease: false }],
    });

    const result = await resolveLatestPatch(
      "repo",
      "1",
      "v1.",
      (tag) => tag.substring(1)
    );
    expect(result).toBe("1.2.3");
  });

  it("throws error if no stable release is found", async () => {
    const mockFetch = global.fetch as jest.Mock;
    // Mock 3 pages of empty/non-matching releases to trigger the final error
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: "llvmorg-19.1.0-rc1", prerelease: false },
        { tag_name: "llvmorg-20.0.0", prerelease: true },
      ],
    });

    const promise = resolveLatestPatch("llvm/llvm-project", "19");
    
    await expect(promise).rejects.toThrow(
      "No stable release found for llvm/llvm-project major 19 within visible historical GitHub releases."
    );
    // Should have tried all 3 pages
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("handles GitHub rate limits with intelligent sleep", async () => {
    const mockFetch = global.fetch as jest.Mock;
    const resetTime = Math.floor(Date.now() / 1000) + 2; // Resets in 2 seconds

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({
          "x-ratelimit-reset": resetTime.toString(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ tag_name: "llvmorg-19.1.7", prerelease: false }],
      });

    const promise = resolveLatestPatch("llvm/llvm-project", "19");

    await Promise.resolve();
    await Promise.resolve();

    // Advance by the rate limit reset time (approx 2s + 1s buffer = 3000ms)
    await jest.advanceTimersByTimeAsync(3000);

    const result = await promise;
    expect(result).toBe("19.1.7");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("GitHub API Rate limit hit")
    );
  });
});

describe("verifyAssetExists", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("verifies asset existence successfully", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        assets: [{ name: "fortran.tar.gz" }, { name: "other.zip" }],
      }),
    });

    await expect(
      verifyAssetExists("repo", "19.1.7", "fortran.tar.gz")
    ).resolves.not.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws error if release does not exist (404)", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: "Not Found" }),
    });

    await expect(
      verifyAssetExists("repo", "19.1.7", "fortran.tar.gz")
    ).rejects.toThrow(
      'Requested version "19.1.7" does not exist (no release for llvmorg-19.1.7 in repo).'
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws error if asset is missing in existing release", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        assets: [{ name: "other.zip" }],
      }),
    });

    await expect(
      verifyAssetExists("repo", "19.1.7", "fortran.tar.gz")
    ).rejects.toThrow(
      'Release llvmorg-19.1.7 in repo exists but has no asset "fortran.tar.gz".'
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on network error and succeeds", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          assets: [{ name: "fortran.tar.gz" }],
        }),
      });

    const promise = verifyAssetExists("repo", "19.1.7", "fortran.tar.gz");
    
    await Promise.resolve();
    await Promise.resolve();

    // Attempt 1 fails. Backoff is 4000ms.
    await jest.advanceTimersByTimeAsync(4000);

    await expect(promise).resolves.not.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Network error encountered (HTTP 503: Service Unavailable)")
    );
  });

  it("retries on timeout and succeeds", async () => {
    const mockFetch = global.fetch as jest.Mock;
    
    // Attempt 1: hangs until aborted
    mockFetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      if (options.signal) {
        options.signal.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      }
    }));
    
    // Attempt 2: succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        assets: [{ name: "fortran.tar.gz" }],
      }),
    });

    const promise = verifyAssetExists("repo", "19.1.7", "fortran.tar.gz");

    await Promise.resolve();
    await Promise.resolve();

    // 1. Trigger timeout (5000ms)
    await jest.advanceTimersByTimeAsync(5000);
    
    await Promise.resolve();
    await Promise.resolve();

    // 2. Trigger backoff (4000ms)
    await jest.advanceTimersByTimeAsync(4000);

    await expect(promise).resolves.not.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining("Network error encountered (Request or body streaming timed out after 5000ms)")
    );
  });

  it("respects custom tagFromPatch", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        assets: [{ name: "fortran.tar.gz" }],
      }),
    });

    await verifyAssetExists(
      "repo",
      "1.2.3",
      "fortran.tar.gz",
      (p) => `v${p}`
    );
    
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/repo/releases/tags/v1.2.3",
      expect.any(Object)
    );
  });
});
