import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Arch, type InstallationResult } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Inputs } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
// Version scheme: YY.M (e.g. "26.1" = January 2026).
// Releases ship roughly every two months.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: [
    "26.5",
    "26.3",
    "26.1",
    "25.11",
    "25.9",
    "25.7",
    "25.5",
    "25.3",
    "25.1",
    "24.11",
    "24.9",
    "24.7",
    "24.5",
    "24.3",
    "24.1",
    "23.11",
    "23.9",
    "23.7",
    "23.5",
    "23.3",
    "23.1",
    "22.11",
    "22.9",
    "22.7",
    "22.5",
    "22.3",
    "22.2",
    "22.1",
    "21.11",
    "21.9",
    "21.7",
    "21.5",
    "21.3",
    "21.2",
    // 21.1 excluded: corrupted package on NVIDIA's x64 apt mirror
    "20.11",
    // 20.9 excluded: predates the apt repo (tarball-only releases)
    // 20.7 excluded: predates the apt repo (tarball-only releases)
  ],
  [Arch.ARM64]: [
    "26.5",
    "26.3",
    "26.1",
    "25.11",
    "25.9",
    "25.7",
    "25.5",
    "25.3",
    "25.1",
    "24.11",
    "24.9",
    "24.7",
    "24.5",
    "24.3",
    "24.1",
    "23.11",
    "23.9",
    "23.7",
    "23.5",
    "23.3",
    "23.1",
    "22.11",
    "22.9",
    "22.7",
    "22.5",
    "22.3",
    "22.2",
    "22.1",
    "21.11",
    "21.9",
    "21.7",
    "21.5",
    "21.3",
    "21.2",
    "21.1",
    "20.11",
    // 20.9 excluded: predates the apt repo (tarball-only releases)
    // 20.7 excluded: predates the apt repo (tarball-only releases)
  ],
} as const satisfies Record<Arch, readonly string[]>;

// Maps Arch to the apt repo architecture string used by NVIDIA.
const APT_ARCH: Record<Arch, string> = {
  [Arch.X64]: "amd64",
  [Arch.ARM64]: "arm64",
};

// Maps Arch to the directory name NVIDIA uses under /opt/nvidia/hpc_sdk/.
const NV_ARCH: Record<Arch, string> = {
  [Arch.X64]: "Linux_x86_64",
  [Arch.ARM64]: "Linux_aarch64",
};

// nvhpc ≤ 24.3 depend on legacy ncurses5 libs (libncursesw5, libtinfo5) that
// were dropped in Ubuntu 24.04 (noble). We backfill them from the jammy archive.
// Ubuntu 22.04 already has them natively so no action is needed there.
const LEGACY_NCURSES_MAX_VERSION = "24.3";

/**
 * Compare two nvhpc version strings of the form "YY.M" or "YY.MM".
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
function compareNvhpcVersions(a: string, b: string): number {
  const [aYear, aMonth] = a.split(".").map(Number);
  const [bYear, bMonth] = b.split(".").map(Number);
  return aYear !== bYear ? aYear - bYear : aMonth - bMonth;
}

async function needsLegacyNcursesInstall(): Promise<boolean> {
  const result = await exec.getExecOutput(
    "dpkg-query",
    ["-W", "-f=${Status}", "libncursesw5", "libtinfo5"],
    { ignoreReturnCode: true },
  );
  // "install ok installed" must appear twice (once per package)
  const installedCount = (result.stdout.match(/install ok installed/g) ?? [])
    .length;
  return installedCount < 2;
}

async function installLegacyNcurses(inputs: Inputs): Promise<void> {
  core.info("Backfilling legacy ncurses5 libs via dynamic direct download...");

  const debArch = APT_ARCH[inputs.arch];
  const baseUrl =
    inputs.arch === Arch.ARM64
      ? "http://ports.ubuntu.com/ubuntu-ports/pool/universe/n/ncurses/"
      : "http://archive.ubuntu.com/ubuntu/pool/universe/n/ncurses/";

  // 1. Fetch directory listing (Forcing IPv4 to bypass GitHub Actions ARM64 network blackholes)
  let dirListing = "";
  await exec.exec("curl", ["-fsSL", "--ipv4", "--retry", "5", baseUrl], {
    listeners: { stdout: (data) => (dirListing += data.toString()) },
  });

  // 2. Extract all matching versions dynamically
  const tinfoRegex = new RegExp(
    `href="(libtinfo5_6\\.3-[^"]+_${debArch}\\.deb)"`,
    "g",
  );
  const ncursesRegex = new RegExp(
    `href="(libncursesw5_6\\.3-[^"]+_${debArch}\\.deb)"`,
    "g",
  );

  const tinfoMatches = Array.from(dirListing.matchAll(tinfoRegex));
  const ncursesMatches = Array.from(dirListing.matchAll(ncursesRegex));

  if (tinfoMatches.length === 0 || ncursesMatches.length === 0) {
    throw new Error(
      `Could not resolve dynamic versions for legacy ncurses5 on ${debArch}.`,
    );
  }

  // 3. Grab the last match (the latest point release in the directory sort)
  const tinfoDeb = tinfoMatches[tinfoMatches.length - 1][1];
  const ncursesDeb = ncursesMatches[ncursesMatches.length - 1][1];

  // 4. Download and install in dependency order (tinfo5 first, then ncursesw5)
  for (const deb of [tinfoDeb, ncursesDeb]) {
    const url = `${baseUrl}${deb}`;
    const dest = path.join(os.tmpdir(), deb);

    core.info(`Downloading ${deb}...`);
    await exec.exec("curl", [
      "--ipv4",
      "--retry",
      "5",
      "--retry-delay",
      "5",
      "--retry-all-errors",
      "--connect-timeout",
      "20",
      "--max-time",
      "120",
      "-fsSL",
      "-o",
      dest,
      url,
    ]);

    core.info(`Installing ${deb} via dpkg...`);
    await exec.exec("sudo", ["dpkg", "-i", dest]);
  }
}

export async function installDebian(
  inputs: Inputs,
): Promise<InstallationResult> {
  const version = resolveVersion(inputs, SUPPORTED_VERSIONS);
  const aptArch = APT_ARCH[inputs.arch];
  const nvArch = NV_ARCH[inputs.arch];

  core.info(`Installing nvfortran ${version} on Linux (${inputs.arch})...`);

  const installDir = `/opt/nvidia/hpc_sdk/${nvArch}/${version}`;
  const binDir = `${installDir}/compilers/bin`;
  const cacheKey = `nvhpc-${version}-${inputs.arch}-${inputs.osVersion}`;

  // --- Cache restore ---
  const cacheHit = await cache.restoreCache([installDir], cacheKey);
  if (cacheHit) {
    core.info(`Restored nvhpc ${version} from cache.`);
  } else {
    if (inputs.cleanupDisk) await cleanupDisk();
    // Add NVIDIA's apt repo.
    // GPG key: https://developer.download.nvidia.com/hpc-sdk/ubuntu/DEB-GPG-KEY-NVIDIA-HPC-SDK
    // Repo:    https://developer.download.nvidia.com/hpc-sdk/ubuntu/{amd64|arm64}
    core.info("Adding NVIDIA HPC SDK apt repository...");
    await exec.exec("bash", [
      "-c",
      `curl -fsSL https://developer.download.nvidia.com/hpc-sdk/ubuntu/DEB-GPG-KEY-NVIDIA-HPC-SDK` +
        ` | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg`,
    ]);
    await exec.exec("bash", [
      "-c",
      `echo 'deb [signed-by=/usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg]` +
        ` https://developer.download.nvidia.com/hpc-sdk/ubuntu/${aptArch} /'` +
        ` | sudo tee /etc/apt/sources.list.d/nvhpc.list`,
    ]);
    await exec.exec("sudo", [
      "apt-get",
      "update",
      "-y",
      "-o",
      "Acquire::http::Timeout=60",
      "-o",
      "Acquire::Retries=3",
    ]);

    core.info("Checking if legacy ncurses5 libs are needed...");

    if (
      compareNvhpcVersions(version, LEGACY_NCURSES_MAX_VERSION) <= 0 &&
      (await needsLegacyNcursesInstall())
    ) {
      core.info(
        `nvhpc ${version} requires legacy ncurses5 libs; installing from jammy archive...`,
      );
      await installLegacyNcurses(inputs);
    }

    // Package name: dots → dashes, e.g. "26.1" → "nvhpc-26-1", "25.11" → "nvhpc-25-11"
    const pkgName = `nvhpc-${version.replace(".", "-")}`;
    core.info(`Installing apt package ${pkgName}...`);
    await exec.exec("sudo", [
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      "-o",
      "Dpkg::Options::=--force-confdef",
      "-o",
      "Dpkg::Options::=--force-confold",
      pkgName,
    ]);

    core.info("Cleaning up apt archives...");
    await exec.exec("sudo", ["apt-get", "clean"]);

    // --- Cache save ---
    // The install lands entirely under installDir, so caching that directory
    // is sufficient to skip apt on subsequent runs.
    core.info(`Saving nvhpc ${version} to cache...`);
    await cache.saveCache([installDir], cacheKey);
  }

  // Export environment regardless of whether we got a cache hit or did a fresh install.
  core.info(`Adding ${binDir} to PATH...`);
  core.addPath(binDir);

  // Make the bundled math/comm libraries findable at runtime.
  const libDir = `${installDir}/compilers/lib`;
  const existingLdPath = process.env.LD_LIBRARY_PATH ?? "";
  core.exportVariable(
    "LD_LIBRARY_PATH",
    existingLdPath ? `${libDir}:${existingLdPath}` : libDir,
  );

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`nvfortran ${resolvedVersion} installed successfully.`);
  const result = {
    version: resolvedVersion,
    fc: "nvfortran",
    cc: "nvc",
    cxx: "nvc++",
  };
  return result;
}

async function cleanupDisk(): Promise<void> {
  let output = "";
  await exec.exec("df", ["--output=avail", "-BG", "/"], {
    listeners: { stdout: (data) => (output += data.toString()) },
    silent: true,
  });

  // parseInt cleanly ignores the trailing 'G' (e.g., "14G" -> 14)
  const availGb = parseInt(output.trim().split("\n")[1], 10);
  core.info(`${availGb.toString()}GB available. Running safe disk cleanup...`);

  // 1. Clear the apt cache to ensure no old .deb files are sitting around
  await exec.exec("sudo", ["apt-get", "clean"]);

  // 2. Prune unused Docker images (Frees ~3-5GB safely)
  // If the user needs an image later, Docker will just download it again.
  await exec.exec("sudo", ["docker", "image", "prune", "--all", "--force"], {
    ignoreReturnCode: true,
    silent: true,
  });

  // 3. Remove large unused toolkits to free up significant space (~10GB+)
  const toolkitsToRemove = [
    "/usr/local/lib/android",
    "/opt/ghc",
    "/usr/share/dotnet",
    "/opt/hostedtoolcache",
  ];

  for (const toolkit of toolkitsToRemove) {
    if (fs.existsSync(toolkit)) {
      core.info(`Removing ${toolkit} to free up disk space...`);
      try {
        await exec.exec("sudo", ["rm", "-rf", toolkit], { silent: true });
      } catch (e) {
        core.debug(`Failed to remove ${toolkit}: ${String(e)}`);
      }
    }
  }

  output = "";
  await exec.exec("df", ["--output=avail", "-BG", "/"], {
    listeners: { stdout: (data) => (output += data.toString()) },
    silent: true,
  });
  const availGbAfter = parseInt(output.trim().split("\n")[1], 10);
  core.info(`${availGbAfter.toString()}GB available after cleanup.`);
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("nvfortran", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
