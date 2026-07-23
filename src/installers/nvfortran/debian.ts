import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Arch, type InstallationResult } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Inputs } from "../../types";

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
    "20.11",
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
  ],
} as const satisfies Record<Arch, readonly string[]>;

const APT_ARCH: Record<Arch, "amd64" | "arm64"> = {
  [Arch.X64]: "amd64",
  [Arch.ARM64]: "arm64",
};

const NV_ARCH: Record<Arch, string> = {
  [Arch.X64]: "Linux_x86_64",
  [Arch.ARM64]: "Linux_aarch64",
};

const LEGACY_NCURSES_MAX_VERSION = "24.3";

const CURL_RETRY_ARGS: readonly string[] = [
  "-4",
  "-L",
  "--retry",
  "10",
  "--retry-delay",
  "5",
  "--retry-max-time",
  "300",
  "--retry-connrefused",
  "--connect-timeout",
  "30",
  "--max-time",
  "600",
  "-fsSL",
];

function compareNvhpcVersions(a: string, b: string): number {
  const [aYear, aMonth] = a.split(".").map(Number);
  const [bYear, bMonth] = b.split(".").map(Number);
  return aYear !== bYear ? aYear - bYear : aMonth - bMonth;
}

async function execWithRetry(
  command: string,
  args: string[],
  maxRetries = 5,
  delayMs = 5000,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await exec.exec(command, args);
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      core.warning(
        `Command "${command} ${args.join(" ")}" failed (attempt ${String(attempt)}/${String(maxRetries)}). Retrying in ${String(delayMs / 1000)}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function needsLegacyNcursesInstall(): Promise<boolean> {
  const result = await exec.getExecOutput(
    "dpkg-query",
    ["-W", "-f=${Status}", "libncursesw5", "libtinfo5"],
    { ignoreReturnCode: true },
  );
  const installedCount = (result.stdout.match(/install ok installed/g) ?? [])
    .length;
  return installedCount < 2;
}

async function installLegacyNcurses(inputs: Inputs): Promise<void> {
  core.info("Backfilling legacy ncurses5 libs...");

  const debArch = APT_ARCH[inputs.arch];
  const baseUrl =
    inputs.arch === Arch.ARM64
      ? "https://ports.ubuntu.com/ubuntu-ports/pool/universe/n/ncurses/"
      : "https://archive.ubuntu.com/ubuntu/pool/universe/n/ncurses/";

  const directUrls: Record<
    "amd64" | "arm64",
    { tinfo: string; ncurses: string }
  > = {
    arm64: {
      tinfo:
        "https://launchpad.net/ubuntu/+archive/primary/+files/libtinfo5_6.3-2_arm64.deb",
      ncurses:
        "https://launchpad.net/ubuntu/+archive/primary/+files/libncursesw5_6.3-2_arm64.deb",
    },
    amd64: {
      tinfo:
        "https://launchpad.net/ubuntu/+archive/primary/+files/libtinfo5_6.3-2_amd64.deb",
      ncurses:
        "https://launchpad.net/ubuntu/+archive/primary/+files/libncursesw5_6.3-2_amd64.deb",
    },
  };

  let tinfoUrl = "";
  let ncursesUrl = "";

  try {
    let dirListing = "";
    await exec.exec("curl", [...CURL_RETRY_ARGS, baseUrl], {
      listeners: { stdout: (data) => (dirListing += data.toString()) },
    });

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

    if (tinfoMatches.length > 0 && ncursesMatches.length > 0) {
      tinfoUrl = `${baseUrl}${tinfoMatches[tinfoMatches.length - 1][1]}`;
      ncursesUrl = `${baseUrl}${ncursesMatches[ncursesMatches.length - 1][1]}`;
    }
  } catch (e) {
    core.warning(
      `Directory scraping failed (${String(e)}). Using direct Launchpad HTTPS mirror.`,
    );
  }

  if (!tinfoUrl || !ncursesUrl) {
    const fallbacks = directUrls[debArch];
    tinfoUrl = fallbacks.tinfo;
    ncursesUrl = fallbacks.ncurses;
  }

  for (const [pkgName, url] of [
    ["libtinfo5", tinfoUrl],
    ["libncursesw5", ncursesUrl],
  ]) {
    const debFile = path.basename(url);
    const dest = path.join(os.tmpdir(), debFile);

    core.info(`Downloading ${pkgName}...`);
    await exec.exec("curl", [...CURL_RETRY_ARGS, "-o", dest, url]);

    core.info(`Installing ${debFile} via dpkg...`);
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

  core.info(
    "Configuring global APT settings (Force IPv4, Timeouts & Retries)...",
  );
  await exec.exec("sudo", [
    "bash",
    "-c",
    'echo \'Acquire::ForceIPv4 "true";\nAcquire::Retries "10";\nAcquire::http::Timeout "60";\nAcquire::https::Timeout "60";\' > /etc/apt/apt.conf.d/99force-ipv4-and-retries',
  ]);

  core.info("Fixing apt mirror to avoid Azure mirror timeouts...");
  const replaceMirrors = (filePath: string): string[] => [
    "sed",
    "-i",
    "-e",
    "s|http://azure.archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g",
    "-e",
    "s|http://azure.ports.ubuntu.com/ubuntu-ports|https://ports.ubuntu.com/ubuntu-ports|g",
    "-e",
    "s|http://ports.ubuntu.com/ubuntu-ports|https://ports.ubuntu.com/ubuntu-ports|g",
    filePath,
  ];

  if (fs.existsSync("/etc/apt/sources.list")) {
    await exec.exec("sudo", replaceMirrors("/etc/apt/sources.list"));
  }
  if (fs.existsSync("/etc/apt/sources.list.d/ubuntu.sources")) {
    await exec.exec(
      "sudo",
      replaceMirrors("/etc/apt/sources.list.d/ubuntu.sources"),
    );
  }

  const installDir = `/opt/nvidia/hpc_sdk/${nvArch}/${version}`;
  const binDir = `${installDir}/compilers/bin`;
  const cacheKey = `nvhpc-${version}-${inputs.arch}-${inputs.osVersion}`;

  const cacheHit = await cache.restoreCache([installDir], cacheKey);
  if (cacheHit) {
    core.info(`Restored nvhpc ${version} from cache.`);
  } else {
    if (inputs.cleanupDisk) await cleanupDisk();

    core.info("Adding NVIDIA HPC SDK apt repository...");
    const curlCmd = `curl ${CURL_RETRY_ARGS.join(" ")} https://developer.download.nvidia.com/hpc-sdk/ubuntu/DEB-GPG-KEY-NVIDIA-HPC-SDK | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg`;
    await execWithRetry("bash", ["-c", curlCmd]);

    await exec.exec("bash", [
      "-c",
      `echo 'deb [signed-by=/usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg]` +
        ` https://developer.download.nvidia.com/hpc-sdk/ubuntu/${aptArch} /'` +
        ` | sudo tee /etc/apt/sources.list.d/nvhpc.list`,
    ]);

    core.info("Updating apt repositories with retry...");
    await execWithRetry("sudo", ["apt-get", "update", "-y"]);

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

    const pkgName = `nvhpc-${version.replace(".", "-")}`;
    core.info(`Installing apt package ${pkgName} with retry...`);
    await execWithRetry("sudo", [
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

    core.info(`Saving nvhpc ${version} to cache...`);
    await cache.saveCache([installDir], cacheKey);
  }

  core.info(`Adding ${binDir} to PATH...`);
  core.addPath(binDir);

  const libDir = `${installDir}/compilers/lib`;
  const existingLdPath = process.env.LD_LIBRARY_PATH ?? "";
  core.exportVariable(
    "LD_LIBRARY_PATH",
    existingLdPath ? `${libDir}:${existingLdPath}` : libDir,
  );

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`nvfortran ${resolvedVersion} installed successfully.`);
  return {
    version: resolvedVersion,
    fc: "nvfortran",
    cc: "nvc",
    cxx: "nvc++",
  };
}

async function cleanupDisk(): Promise<void> {
  let output = "";
  await exec.exec("df", ["--output=avail", "-BG", "/"], {
    listeners: { stdout: (data) => (output += data.toString()) },
    silent: true,
  });

  const availGb = parseInt(output.trim().split("\n")[1], 10);
  core.info(`${availGb.toString()}GB available. Running safe disk cleanup...`);

  await exec.exec("sudo", ["apt-get", "clean"]);
  await exec.exec("sudo", ["docker", "image", "prune", "--all", "--force"], {
    ignoreReturnCode: true,
    silent: true,
  });

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
