import {
  resolveVersion,
  resolveWindowsVersion,
  resolveLatestPatch,
  verifyAssetExists,
} from "../src/resolve_version";
import { Arch, Compiler, LATEST, OS, Msystem } from "../src/types";
import type { Inputs } from "../src/types";
import * as core from "@actions/core";

jest.mock("@actions/core");

const baseInputs: Inputs = {
  compiler: Compiler.GFortran,
  version: LATEST,
  os: OS.Linux,
  osVersion: "22.04",
  arch: Arch.X64,
  msystem: Msystem.Native,
  cleanupDisk: false,
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
      const result = resolveVersion(baseInputs, SUPPORTED);
      expect(result).toBe("15");
    });

    it("returns the first entry for arm64", () => {
      const inputs: Inputs = { ...baseInputs, arch: Arch.ARM64 };
      const result = resolveVersion(inputs, SUPPORTED);
      expect(result).toBe("14");
    });
  });

  describe("when a specific version is requested", () => {
    it("returns the version if it is supported", () => {
      const inputs: Inputs = { ...baseInputs, version: "14" };
      const result = resolveVersion(inputs, SUPPORTED);
      expect(result).toBe("14");
    });

    it("handles 2-part versions like 24.1 if present in supported list", () => {
      const inputs: Inputs = { ...baseInputs, version: "24.1" };
      const supported = { [Arch.X64]: ["24.3", "24.1"] };
      const result = resolveVersion(inputs, supported);
      expect(result).toBe("24.1");
    });

    it("throws if the version is not supported on this arch", () => {
      const inputs: Inputs = { ...baseInputs, arch: Arch.ARM64, version: "15" };
      expect(() => resolveVersion(inputs, SUPPORTED)).toThrow(
        "gfortran 15 is not supported on linux (arm64). Supported versions: 14, 13",
      );
    });

    it("throws if the version is not supported on any arch", () => {
      const inputs: Inputs = { ...baseInputs, version: "9" };
      expect(() => resolveVersion(inputs, SUPPORTED)).toThrow(
        "gfortran 9 is not supported on linux (x64). Supported versions: 15, 14, 13",
      );
    });
  });

  describe("resolveMinorToLatestPatch", () => {
    const supported = {
      [Arch.X64]: ["2025.2.1", "2025.2.0", "2025.1.0", "2024.0.0"],
    };

    it("resolves YYYY.minor to the latest patch if resolveMinorToLatestPatch is true", () => {
      const inputs: Inputs = { ...baseInputs, version: "2025.2" };
      const result = resolveVersion(inputs, supported, {
        resolveMinorToLatestPatch: true,
      });
      expect(result).toBe("2025.2.1");
    });

    it("returns the original version if resolveMinorToLatestPatch is false", () => {
      const inputs: Inputs = { ...baseInputs, version: "2024.0.0" };
      const result = resolveVersion(inputs, supported, {
        resolveMinorToLatestPatch: false,
      });
      expect(result).toBe("2024.0.0");
    });

    it("does not affect 3-part versions", () => {
      const inputs: Inputs = { ...baseInputs, version: "2025.2.0" };
      const result = resolveVersion(inputs, supported, {
        resolveMinorToLatestPatch: true,
      });
      expect(result).toBe("2025.2.0");
    });

    it("returns the latest patch even if the requested version is a latest patch", () => {
      const inputs: Inputs = { ...baseInputs, version: "2025.2.1" };
      const result = resolveVersion(inputs, supported, {
        resolveMinorToLatestPatch: true,
      });
      expect(result).toBe("2025.2.1");
    });
  });
});

describe("resolveWindowsVersion", () => {
  const winInputs: Inputs = {
    ...baseInputs,
    os: OS.Windows,
    osVersion: "2022",
    arch: Arch.X64,
    msystem: Msystem.Native,
  };

  const SUPPORTED_WIN = {
    [Arch.X64]: {
      [Msystem.Native]: ["14", "13"],
      [Msystem.UCRT64]: ["latest"],
    }
  };

  it("returns the requested version if it matches the first entry for x64", () => {
    const result = resolveWindowsVersion(winInputs, SUPPORTED_WIN as any);
    expect(result).toBe("14");
  });

  it("returns the requested version if supported", () => {
    const inputs: Inputs = { ...winInputs, version: "13" };
    const result = resolveWindowsVersion(inputs, SUPPORTED_WIN as any);
    expect(result).toBe("13");
  });

  it("returns latest for UCRT64 msystem", () => {
    const inputs: Inputs = { ...winInputs, msystem: Msystem.UCRT64 };
    const result = resolveWindowsVersion(inputs, SUPPORTED_WIN as any);
    expect(result).toBe("latest");
  });

  it("throws if version is not supported", () => {
    const inputs: Inputs = { ...winInputs, version: "9" };
    expect(() => resolveWindowsVersion(inputs, SUPPORTED_WIN as any)).toThrow(
      "gfortran 9 is not supported on win32 (x64). Supported versions: 14, 13",
    );
  });
});

describe("resolveLatestPatch", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("resolves the latest patch version correctly", async () => {
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
    
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(4000);

    const result = await promise;
    expect(result).toBe("19.1.7");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on timeout and eventually succeeds", async () => {
    const mockFetch = global.fetch as jest.Mock;
    
    mockFetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      if (options.signal) {
        options.signal.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      }
    }));
    
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ tag_name: "llvmorg-19.1.7", prerelease: false }],
    });

    const promise = resolveLatestPatch("llvm/llvm-project", "19");

    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(5000);
    
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(4000);

    const result = await promise;
    expect(result).toBe("19.1.7");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws error after exhausting all retries", async () => {
    const mockFetch = global.fetch as jest.Mock;
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
    });

    const promise = resolveLatestPatch("llvm/llvm-project", "19");
    promise.catch(() => {});

    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(4000);
    
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(8000);
    
    await Promise.resolve();
    await Promise.resolve();

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
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("handles GitHub rate limits with intelligent sleep", async () => {
    const mockFetch = global.fetch as jest.Mock;
    const resetTime = Math.floor(Date.now() / 1000) + 2;

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

    await jest.advanceTimersByTimeAsync(3000);

    const result = await promise;
    expect(result).toBe("19.1.7");
    expect(mockFetch).toHaveBeenCalledTimes(2);
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

    await jest.advanceTimersByTimeAsync(4000);

    await expect(promise).resolves.not.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on timeout and succeeds", async () => {
    const mockFetch = global.fetch as jest.Mock;
    
    mockFetch.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      if (options.signal) {
        options.signal.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      }
    }));
    
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

    await jest.advanceTimersByTimeAsync(5000);
    
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(4000);

    await expect(promise).resolves.not.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(2);
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
