import * as core from "@actions/core";

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

  // If the version is LATEST, use the first version (should be the highest).
  const version = target.version === LATEST ? versions[0] : target.version;

  if (!version) {
    throw new Error(
      `No supported versions found for ${target.compiler} on ` +
        `${target.os} (${target.arch}).`,
    );
  }

  // If a full patch version was supplied (e.g. "22.1.0"), validate either the
  // major or the full version against the supported list. The caller is
  // responsible for using the full patch for download resolution.
  const { major } = parseMajorOrPatch(version);

  if (
    !(versions as readonly string[]).includes(major) &&
    !(versions as readonly string[]).includes(version)
  ) {
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
    throw new Error(
      `The environment "${windowsEnv}" is not supported or implemented for Windows ${target.arch}.`,
    );
  }

  return resolveVersion(target, { [target.arch]: versions });
}

// Parses a version string into a major and an optional full patch version.
//
// Accepted formats:
//   "22"       → { major: "22", patch: undefined }  — resolve latest patch via API
//   "22.1"     → { major: "22", patch: "22.1" }     — use exactly this minor
//   "22.1.3"   → { major: "22", patch: "22.1.3" }   — use exactly this patch
//
// Other formats are rejected to avoid ambiguity.
export function parseMajorOrPatch(input: string): {
  major: string;
  patch: string | undefined;
} {
  const parts = input.split(".");
  if (parts.length === 1) return { major: parts[0], patch: undefined };
  if (parts.length === 2 || parts.length === 3) {
    return { major: parts[0], patch: input };
  }
  throw new Error(
    `Invalid version format: "${input}". ` +
      `Specify a major version (e.g. "22"), a minor version (e.g. "22.1"), or a full patch version (e.g. "22.1.3").`,
  );
}

// Fetches the latest stable patch version for a given major from a GitHub
// repository's releases. Returns a full version string like "22.1.3".
//
// tagPrefix: prefix used to match release tags (default: "llvmorg-{major}.").
// tagStripper: converts a matched tag to a version string (default: strips "llvmorg-").
export async function resolveLatestPatch(
  repo: string,
  major: string,
  tagPrefix = `llvmorg-${major}.`,
  tagStripper: (tag: string) => string = (tag) => tag.replace("llvmorg-", ""),
): Promise<string> {
  core.info(
    `Resolving latest patch version for ${repo} major ${major} via GitHub API...`,
  );

  const response = await fetch(
    `https://api.github.com/repos/${repo}/releases?per_page=100`,
    { headers: githubHeaders() },
  );

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed: ${response.status.toString()} ${response.statusText}`,
    );
  }

  const releases = (await response.json()) as {
    tag_name: string;
    prerelease: boolean;
  }[];

  const match = releases.find(
    (r) =>
      r.tag_name.startsWith(tagPrefix) &&
      !r.prerelease &&
      !r.tag_name.includes("rc"),
  );

  if (!match) {
    throw new Error(
      `No stable release found for ${repo} major ${major} in the last 100 GitHub releases.`,
    );
  }

  return tagStripper(match.tag_name);
}

// Verifies that a specific release exists on GitHub and that the named asset
// is present. Throws with a clear message (and a link to the release page)
// if either check fails.
//
// tagFromPatch: converts a patch version string to the GitHub release tag.
//   Default: (patch) => `llvmorg-${patch}` (LLVM convention).
export async function verifyAssetExists(
  repo: string,
  patch: string,
  filename: string,
  tagFromPatch: (patch: string) => string = (p) => `llvmorg-${p}`,
): Promise<void> {
  const tag = tagFromPatch(patch);
  core.info(`Verifying that ${filename} exists for ${repo} release ${tag}...`);

  const response = await fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
    { headers: githubHeaders() },
  );

  if (response.status === 404) {
    throw new Error(
      `Requested version "${patch}" does not exist (no release for ${tag} in ${repo}).`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed for ${tag}: ${response.status.toString()} ${response.statusText}`,
    );
  }

  const release = (await response.json()) as { assets: { name: string }[] };

  if (!release.assets.some((a) => a.name === filename)) {
    throw new Error(
      `Release ${tag} in ${repo} exists but has no asset "${filename}". ` +
        `See https://github.com/${repo}/releases/tag/${tag} for available assets.`,
    );
  }
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
