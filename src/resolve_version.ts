import { LATEST, type WindowsEnv, type Target } from "./types";

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

  // If the version is LATEST, use the first version (should be the highest)
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
      `Architecture "${target.arch}" is currently not supported for ${target.compiler} on Windows.`,
    );
  }

  const windowsEnv = target.windowsEnv;
  const versions = archVersions[windowsEnv];

  if (!versions) {
    throw new Error(
      `The environment "${windowsEnv}" is not supported or implemented for Windows ${target.arch}.`,
    );
  }

  return resolveVersion(target, { [target.arch]: versions });
}
