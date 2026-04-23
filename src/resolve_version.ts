import { Arch, LATEST, WindowsEnv, type Target } from "./types";

export function resolveVersion<T extends readonly string[]>(
  target: Target,
  supportedVersions: Record<string, T | undefined>,
): string {
  const versions = supportedVersions[target.arch];

  if (!versions) {
    throw new Error(
      `No supported versions found for ${target.compiler} on ` +
        `${target.os} (${target.arch}).`,
    );
  }

  const version = target.version === LATEST ? versions[0] : target.version;

  if (!version) {
    throw new Error(
      `No supported versions found for ${target.compiler} on ` +
        `${target.os} (${target.arch}).`,
    );
  }

  if (!(versions as readonly string[]).includes(version)) {
    throw new Error(
      `${target.compiler} ${version} is not supported on ` +
        `${target.os} (${target.arch}). ` +
        `Supported versions: ${versions.join(", ")}`,
    );
  }

  return version;
}

export function resolveWindowsVersion(
  target: Target,
  supportedVersions: Record<
    string,
    Record<WindowsEnv, readonly string[] | undefined> | undefined
  >,
): string {
  const archVersions = supportedVersions[target.arch];

  if (!archVersions) {
    throw new Error(
      `Architecture "${target.arch}" is not supported for ${target.compiler} on Windows.`,
    );
  }

  const windowsEnv = target.windowsEnv;
  const versions = archVersions[windowsEnv];

  if (!versions) {
    if (windowsEnv === WindowsEnv.ClangArm64 && target.arch === Arch.X64) {
      throw new Error(
        `Invalid configuration: "${WindowsEnv.ClangArm64}" is only available for ARM64 architecture, but the current runner is ${target.arch}.`,
      );
    }

    if (
      (windowsEnv === WindowsEnv.UCRT64 || windowsEnv === WindowsEnv.Clang64) &&
      target.arch === Arch.ARM64
    ) {
      throw new Error(
        `Invalid configuration: "${windowsEnv}" is not currently supported on Windows ARM64. Please use ${WindowsEnv.ClangArm64} instead.`,
      );
    }

    throw new Error(
      `The environment "${windowsEnv}" is not supported or implemented for Windows ${target.arch}.`,
    );
  }

  return resolveVersion(target, { [target.arch]: versions });
}
