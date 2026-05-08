import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["16", "15", "14", "13", "12", "11"],
  [Arch.ARM64]: ["16", "15", "14", "13", "12", "11"],
} as const satisfies Record<Arch, readonly string[]>;

const CACHE_PATHS = ["/var/cache/apt/archives"];

function aptCacheKey(version: string, osVersion: string): string {
  return `apt-gfortran-${osVersion}-${version}`;
}

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  core.info(`Installing GFortran ${version} on Linux (${target.arch})...`);

  const cacheKey = aptCacheKey(version, target.osVersion);
  const cacheHit = await cache.restoreCache(CACHE_PATHS, cacheKey);

  if (cacheHit) {
    core.info(`Cache hit for ${cacheKey}, installing from cache...`);
    await exec.exec("sudo", [
      "apt-get",
      "install",
      "-y",
      "--no-download",
      "--ignore-missing",
      `gcc-${version}`,
      `gfortran-${version}`,
    ]);
  } else {
    if (needsPpa(version, target.osVersion)) {
      core.info(`Adding PPA for GFortran ${version}...`);
      await addAptRepositoryWithRetry("ppa:ubuntu-toolchain-r/test");
    }
    await aptGetInstallWithRetry([`gcc-${version}`, `gfortran-${version}`]);
    await cache.saveCache(CACHE_PATHS, cacheKey);
  }

  await exec.exec("sudo", [
    "update-alternatives",
    "--install",
    "/usr/bin/gcc",
    "gcc",
    `/usr/bin/gcc-${version}`,
    "100",
    "--slave",
    "/usr/bin/gfortran",
    "gfortran",
    `/usr/bin/gfortran-${version}`,
  ]);

  core.info(`Setting FC, F77, and F90 environment variables...`);
  core.exportVariable("FC", `gfortran-${version}`);
  core.exportVariable("F77", `gfortran-${version}`);
  core.exportVariable("F90", `gfortran-${version}`);
  core.exportVariable("CC", `gcc-${version}`);
  core.exportVariable("CXX", `g++-${version}`);
  core.exportVariable("FPM_FC", `gfortran-${version}`);
  core.exportVariable("FPM_CC", `gcc-${version}`);
  core.exportVariable("FPM_CXX", `g++-${version}`);

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`GFortran ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function aptGetInstallWithRetry(
  packages: string[],
  maxAttempts = 5,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await exec.exec("sudo", [
        "apt-get",
        "update",
        "-y",
        "-o",
        "Acquire::http::Timeout=60",
        "-o",
        "Acquire::Retries=3",
      ]);
      await exec.exec("sudo", [
        "apt-get",
        "install",
        "-y",
        "-o",
        "Acquire::http::Timeout=60",
        "-o",
        "Acquire::Retries=3",
        ...packages,
      ]);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      core.warning(
        `apt-get install failed (attempt ${attempt.toString()}/${maxAttempts.toString()}), retrying in ${(attempt * 10).toString()}s...`,
      );
      await new Promise((res) => setTimeout(res, attempt * 10_000));
    }
  }
}

export function needsPpa(version: string, osVersion: string): boolean {
  const v = parseInt(version);
  if (osVersion.includes("24")) return v >= 15;
  if (osVersion.includes("22")) return v >= 13;
  return true;
}

async function addAptRepositoryWithRetry(
  ppa: string,
  maxAttempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await exec.exec("sudo", ["add-apt-repository", "--yes", ppa]);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      core.warning(
        `add-apt-repository failed (attempt ${attempt.toString()}/${maxAttempts.toString()}), retrying in ${(attempt * 10).toString()}s...`,
      );
      await new Promise((res) => setTimeout(res, attempt * 5_000));
    }
  }
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("gfortran", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
