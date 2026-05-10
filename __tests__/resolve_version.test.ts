import { resolveVersion, resolveWindowsVersion } from "../src/resolve_version";
import { Arch, Compiler, LATEST, OS, Msystem } from "../src/types";
import type { Target } from "../src/types";

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
