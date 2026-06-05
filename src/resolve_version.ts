import * as core from "@actions/core";
import { LATEST, type Msystem, type Target } from "./types";

// ==========================================
// Reusable Network Helper (Upgraded)
// ==========================================

interface FetchRetryOptions {
  maxRetries?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

interface FetchResult<T> {
  status: number;
  data: T | null;
}

/**
 * A production-grade wrapper around native fetch that handles stream timeouts,
 * precise GitHub rate-limit reset windows, and exponential backoff.
 */
async function fetchJsonWithRetry<T>(
  url: string,
  options: FetchRetryOptions = {},
): Promise<FetchResult<T>> {
  const maxRetries = options.maxRetries ?? 3;
  const timeoutMs = options.timeoutMs ?? 5000;
  const fetchOptions = { headers: options.headers };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      if (response.status === 404) {
        clearTimeout(timeoutId);
        return { status: 404, data: null };
      }

      // Handle Rate Limiting Intelligent Sleep
      if (response.status === 403 || response.status === 429) {
        const resetHeader = response.headers.get("x-ratelimit-reset");
        if (resetHeader) {
          const resetTimeMs = parseInt(resetHeader, 10) * 1000;
          const sleepTimeMs = Math.max(resetTimeMs - Date.now() + 1000, 2000);

          core.warning(
            `GitHub API Rate limit hit (Status ${response.status.toString()}). ` +
              `Sleeping for ${(sleepTimeMs / 1000).toString()}s until reset window opens...`,
          );

          clearTimeout(timeoutId);
          await new Promise((resolve) => setTimeout(resolve, sleepTimeMs));
          continue;
        }
      }

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status.toString()}: ${response.statusText}`,
        );
      }

      const data = (await response.json()) as T;
      clearTimeout(timeoutId);
      return { status: response.status, data };
    } catch (e) {
      clearTimeout(timeoutId);

      const error = e instanceof Error ? e : new Error(String(e));
      const isAbort = error.name === "AbortError";
      const errorMessage = isAbort
        ? `Request or body streaming timed out after ${timeoutMs.toString()}ms`
        : error.message;

      if (attempt === maxRetries) {
        throw new Error(
          `Request failed after ${maxRetries.toString()} attempts. Last error: ${errorMessage}`,
          { cause: e },
        );
      }

      const backoffMs = 1000 * Math.pow(2, attempt + 1);
      core.warning(
        `Network error encountered (${errorMessage}). Retrying in ${(backoffMs / 1000).toString()}s ` +
          `(Attempt ${attempt.toString()}/${maxRetries.toString()})...`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw new Error("Unreachable");
}

// ==========================================
// Exported Core Functions
// ==========================================

export function resolveVersion<T extends readonly string[]>(
  target: Target,
  supportedVersions: Record<string, T | undefined>,
  {
    matchMajorIfPatch = false,
    resolveMinorToLatestPatch = false,
  }: { matchMajorIfPatch?: boolean; resolveMinorToLatestPatch?: boolean } = {},
): string {
  const versions = supportedVersions[target.arch];

  if (!versions) {
    throw new Error(
      `No supported versions found for ${target.compiler} on ${target.os} (${target.arch}).`,
    );
  }

  const version = target.version === LATEST ? versions[0] : target.version;

  if (!version) {
    throw new Error(
      `No supported versions found for ${target.compiler} on ${target.os} (${target.arch}).`,
    );
  }

  const versionList = versions as readonly string[];
  if (!versionList.includes(version)) {
    if (matchMajorIfPatch) {
      const major = parseMajorOrPatch(version).major;
      if (versionList.includes(major)) {
        return version;
      }
    }

    // FIX: Modified standard regex to accept BOTH standard semantic numbers (e.g. 14.1) and years (e.g. 2025.1)
    if (resolveMinorToLatestPatch && /^\d+\.\d+$/.test(version)) {
      const prefix = `${version}.`;
      const match = versionList.find((v) => v.startsWith(prefix));
      if (match) {
        return match;
      }
    }

    throw new Error(
      `${target.compiler} ${version} is not supported on ${target.os} (${target.arch}). ` +
        `Supported versions: ${versions.join(", ")}`,
    );
  }

  return version;
}

export function resolveWindowsVersion(
  target: Target,
  supportedVersions: Record<
    string,
    Record<Msystem, readonly string[] | undefined> | undefined
  >,
  {
    matchMajorIfPatch = false,
    resolveMinorToLatestPatch = false,
  }: { matchMajorIfPatch?: boolean; resolveMinorToLatestPatch?: boolean } = {},
): string {
  const archVersions = supportedVersions[target.arch];
  if (!archVersions) {
    throw new Error(
      `Architecture "${target.arch}" is not supported for ${target.compiler} on Windows.`,
    );
  }

  const msystem = target.msystem;
  const versions = archVersions[msystem];
  if (!versions) {
    throw new Error(
      `The environment "${msystem}" is not supported or implemented for Windows ${target.arch}.`,
    );
  }

  return resolveVersion(
    target,
    { [target.arch]: versions },
    { matchMajorIfPatch, resolveMinorToLatestPatch },
  );
}

// FIX: Handles string segmentation gracefully for minor versions (length === 2)
export function parseMajorOrPatch(input: string): {
  major: string;
  patch: string | undefined;
} {
  const parts = input.split(".");
  if (parts.length >= 1 && parts.length <= 3) {
    return {
      major: parts[0],
      patch: parts.length === 3 ? input : undefined,
    };
  }
  throw new Error(
    `Invalid version format: "${input}". Specify a major version (e.g. "22"), minor (e.g. "22.1") or full patch version (e.g. "22.1.3").`,
  );
}

interface GitHubRelease {
  tag_name: string;
  prerelease: boolean;
}

// FIX: Added multi-page fallback strategy to guarantee legacy version visibility
export async function resolveLatestPatch(
  repo: string,
  major: string,
  tagPrefix = `llvmorg-${major}.`,
  tagStripper: (tag: string) => string = (tag) => tag.replace("llvmorg-", ""),
): Promise<string> {
  core.info(
    `Resolving latest patch version for ${repo} major ${major} via GitHub API...`,
  );

  // Walk up to 3 pagination indexes to unearth deep historical patches
  for (let page = 1; page <= 3; page++) {
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page.toString()}`;
    const { data: releases } = await fetchJsonWithRetry<GitHubRelease[]>(url, {
      headers: githubHeaders(),
    });

    if (!releases || releases.length === 0) {
      break;
    }

    const match = releases.find(
      (r) =>
        r.tag_name.startsWith(tagPrefix) &&
        !r.prerelease &&
        !r.tag_name.includes("rc"),
    );

    if (match) {
      return tagStripper(match.tag_name);
    }
  }

  throw new Error(
    `No stable release found for ${repo} major ${major} within visible historical GitHub releases.`,
  );
}

interface GitHubTagMetadata {
  assets: { name: string }[];
}

export async function verifyAssetExists(
  repo: string,
  patch: string,
  filename: string,
  tagFromPatch: (patch: string) => string = (p) => `llvmorg-${p}`,
): Promise<void> {
  const tag = tagFromPatch(patch);
  core.info(`Verifying that ${filename} exists for ${repo} release ${tag}...`);

  const url = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
  const { status, data: release } = await fetchJsonWithRetry<GitHubTagMetadata>(
    url,
    {
      headers: githubHeaders(),
    },
  );

  if (status === 404) {
    throw new Error(
      `Requested version "${patch}" does not exist (no release for ${tag} in ${repo}).`,
    );
  }

  if (!release) {
    throw new Error(
      `Failed to fetch release metadata for tag ${tag} in ${repo}.`,
    );
  }

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
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    core.warning(
      "GITHUB_TOKEN is missing from the environment. Concurrent execution of these tests will likely hit rate limits and fail.",
    );
  }
  return headers;
}
