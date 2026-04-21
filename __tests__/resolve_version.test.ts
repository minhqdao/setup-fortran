import { resolveVersion } from "../src/resolve_version";
import { Arch, Compiler, LATEST, OS, WindowsEnv } from "../src/types";
import type { Target } from "../src/types";

const baseTarget: Target = {
  compiler: Compiler.GCC,
  version: LATEST,
  os: OS.Linux,
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
        "gcc 15 is not supported on linux (arm64). Supported versions: 14, 13",
      );
    });

    it("throws if the version is not supported on any arch", () => {
      const target: Target = { ...baseTarget, version: "9" };
      expect(() => resolveVersion(target, SUPPORTED)).toThrow(
        "gcc 9 is not supported on linux (x64). Supported versions: 15, 14, 13",
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
        "No supported versions found for gcc on linux (x64).",
      );
    });

    it("throws if arch is entirely missing from supportedVersions", () => {
      const x64Only: Record<string, readonly string[]> = {
        [Arch.X64]: ["15", "14"],
      };
      const target: Target = { ...baseTarget, arch: Arch.ARM64 };
      expect(() => resolveVersion(target, x64Only)).toThrow(
        "No supported versions found for gcc on linux (arm64).",
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
