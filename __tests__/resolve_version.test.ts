import {
  resolveVersion,
  resolveWindowsVersion,
} from "../src/resolve_version";
import { Arch, Compiler, LATEST, OS, WindowsEnv } from "../src/types";
import type { Target } from "../src/types";

const baseTarget: Target = {
  compiler: Compiler.GFortran,
  version: LATEST,
  os: OS.Linux,
  osVersion: "22.04",
  arch: Arch.X64,
  windowsEnv: WindowsEnv.Native,
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
        version: "2024.0",
      };
      const supported: Record<string, readonly string[]> = {
        [Arch.X64]: ["2024.1", "2023.2"],
      };
      expect(() => resolveVersion(target, supported)).toThrow(
        "ifx 2024.0 is not supported on linux (x64). Supported versions: 2024.1, 2023.2",
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
    Record<WindowsEnv, readonly string[] | undefined>
  > = {
    [Arch.X64]: {
      [WindowsEnv.Native]: ["15", "14"],
      [WindowsEnv.UCRT64]: ["14", "13"],
      [WindowsEnv.Clang64]: ["15"],
      [WindowsEnv.ClangArm64]: undefined,
      [WindowsEnv.MinGW64]: ["12"],
    },
    [Arch.ARM64]: {
      [WindowsEnv.Native]: ["14"],
      [WindowsEnv.ClangArm64]: ["14"],
      [WindowsEnv.UCRT64]: undefined,
      [WindowsEnv.Clang64]: undefined,
      [WindowsEnv.MinGW64]: undefined,
    },
  };

  it("resolves LATEST for a specific windowsEnv", () => {
    const target = { ...winTarget, windowsEnv: WindowsEnv.UCRT64 };
    const result = resolveWindowsVersion(target, SUPPORTED_WIN);
    expect(result).toBe("14");
  });

  it("resolves a specific version for a specific windowsEnv", () => {
    const target = {
      ...winTarget,
      windowsEnv: WindowsEnv.Native,
      version: "14",
    };
    const result = resolveWindowsVersion(target, SUPPORTED_WIN);
    expect(result).toBe("14");
  });

  it("throws if windowsEnv is not supported for the arch", () => {
    const target = { ...winTarget, windowsEnv: WindowsEnv.ClangArm64 };
    expect(() => resolveWindowsVersion(target, SUPPORTED_WIN)).toThrow(
      'Invalid configuration: "clangarm64" is only available for ARM64 architecture, but the current runner is x64.',
    );
  });

  it("throws if UCRT64/Clang64 is used on ARM64", () => {
    const target = { ...winTarget, arch: Arch.ARM64, windowsEnv: WindowsEnv.UCRT64 };
    expect(() => resolveWindowsVersion(target, SUPPORTED_WIN)).toThrow(
      'Invalid configuration: "ucrt64" is not currently supported on Windows ARM64. Please use clangarm64 instead.',
    );
  });

  it("throws if the environment is not supported for that architecture", () => {
    const target = {
      ...winTarget,
      windowsEnv: WindowsEnv.MinGW64,
      arch: Arch.ARM64,
    };
    // Need a mock SUPPORTED_WIN where ARM64 exists but MinGW64 is missing
    const supported: typeof SUPPORTED_WIN = {
      ...SUPPORTED_WIN,
      [Arch.ARM64]: {
        [WindowsEnv.Native]: ["14"],
      } as any,
    };
    expect(() => resolveWindowsVersion(target, supported)).toThrow(
      'The environment "mingw64" is not supported or implemented for Windows arm64.',
    );
  });

  it("throws if the version is not supported for that windowsEnv", () => {
    const target = {
      ...winTarget,
      windowsEnv: WindowsEnv.UCRT64,
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
});
