import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as os from "os";
import * as path from "path";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
// Version scheme: YY.M (e.g. "26.1" = January 2026).
// Releases ship roughly every two months.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: [
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

// amd64 lives on archive.ubuntu.com; other arches (including arm64) are on ports.
const NCURSES_ARCHIVE_BASE: Record<Arch, string> = {
  [Arch.X64]: "http://archive.ubuntu.com/ubuntu",
  [Arch.ARM64]: "http://ports.ubuntu.com/ubuntu-ports",
};

const NCURSES_JAMMY_VERSION = "6.3-2ubuntu0.1";

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

/**
 * Install libncursesw5 and libtinfo5 from the Ubuntu jammy archive.
 * Must be called before installing the nvhpc apt package.
 * Install order matters: libtinfo5 first, because libncursesw5 depends on it.
 */
async function installLegacyNcurses(target: Target): Promise<void> {
  const base = NCURSES_ARCHIVE_BASE[target.arch];
  const debArch = APT_ARCH[target.arch];
  const poolPath = "pool/universe/n/ncurses";

  // libtinfo5 must be installed before libncursesw5 (dependency order).
  const debs = [
    `libtinfo5_${NCURSES_JAMMY_VERSION}_${debArch}.deb`,
    `libncursesw5_${NCURSES_JAMMY_VERSION}_${debArch}.deb`,
  ];

  for (const deb of debs) {
    const url = `${base}/${poolPath}/${deb}`;
    const dest = path.join(os.tmpdir(), deb);
    core.info(`Downloading ${deb} from jammy archive...`);
    await exec.exec("curl", ["-fsSL", "-o", dest, url]);
    await exec.exec("sudo", ["dpkg", "-i", dest]);
  }
}

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  const aptArch = APT_ARCH[target.arch];
  const nvArch = NV_ARCH[target.arch];

  core.info(`Installing nvfortran ${version} on Linux (${target.arch})...`);

  const installDir = `/opt/nvidia/hpc_sdk/${nvArch}/${version}`;
  const binDir = `${installDir}/compilers/bin`;
  const cacheKey = `nvhpc-${version}-${target.arch}-${target.osVersion}`;

  // --- Cache restore ---
  const cacheHit = await cache.restoreCache([installDir], cacheKey);
  if (cacheHit) {
    core.info(`Restored nvhpc ${version} from cache.`);
  } else {
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
    await exec.exec("sudo", ["apt-get", "update", "-y"]);

    core.info("Checking if ");

    if (
      compareNvhpcVersions(version, LEGACY_NCURSES_MAX_VERSION) <= 0 &&
      (await needsLegacyNcursesInstall())
    ) {
      core.info(
        `nvhpc ${version} requires legacy ncurses5 libs; installing from jammy archive...`,
      );
      await installLegacyNcurses(target);
    }

    // Package name: dots → dashes, e.g. "26.1" → "nvhpc-26-1", "25.11" → "nvhpc-25-11"
    const pkgName = `nvhpc-${version.replace(".", "-")}`;
    core.info(`Installing apt package ${pkgName}...`);
    await exec.exec("sudo", [
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      pkgName,
    ]);

    // --- Cache save ---
    // The install lands entirely under installDir, so caching that directory
    // is sufficient to skip apt on subsequent runs.
    core.info(`Saving nvhpc ${version} to cache...`);
    await cache.saveCache([installDir], cacheKey);
  }

  // Export environment regardless of whether we got a cache hit or did a fresh install.
  core.info(`Adding ${binDir} to PATH...`);
  core.addPath(binDir);

  core.exportVariable("FC", "nvfortran");
  core.exportVariable("CC", "nvc");
  core.exportVariable("CXX", "nvc++");

  // Make the bundled math/comm libraries findable at runtime.
  const libDir = `${installDir}/compilers/lib`;
  const existingLdPath = process.env.LD_LIBRARY_PATH ?? "";
  core.exportVariable(
    "LD_LIBRARY_PATH",
    existingLdPath ? `${libDir}:${existingLdPath}` : libDir,
  );

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`nvfortran ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
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
