import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Arch, type InstallationResult, type Inputs } from "../../types";
import { resolveVersion } from "../../resolve_version";

const SUPPORTED_VERSIONS = {
  [Arch.X64]: undefined,
  [Arch.ARM64]: ["22.1", "21.1", "20.1"],
} as const satisfies Record<Arch, readonly string[] | undefined>;

const PACKAGE = "arm-toolchain-for-linux";
const INSTALL_DIR = "/opt/arm/arm-toolchain-for-linux";
const CURL_RETRY_ARGS = [
  "-4",
  "-L",
  "--retry",
  "5",
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
] as const;
const APT_ACQUIRE_OPTS = [
  "-o",
  "Acquire::http::Timeout=120",
  "-o",
  "Acquire::https::Timeout=120",
  "-o",
  "Acquire::Retries=5",
] as const;

function ubuntuRepository(osVersion: string): {
  release: string;
  codename: string;
} {
  if (osVersion.includes("24.04") || osVersion.includes("ubuntu24")) {
    return { release: "24", codename: "noble" };
  }
  if (osVersion.includes("22.04") || osVersion.includes("ubuntu22")) {
    return { release: "22", codename: "jammy" };
  }
  throw new Error(
    `ArmFlang is only supported on Ubuntu 22.04 and 24.04 (got: ${osVersion}).`,
  );
}

async function availablePackageVersion(version: string): Promise<string> {
  const output = await exec.getExecOutput("apt-cache", ["madison", PACKAGE]);
  const versions = output.stdout
    .split("\n")
    .map((line) => line.split("|").at(1)?.trim() ?? "")
    .filter((candidate) => candidate.length > 0);
  const match = versions.find(
    (candidate) =>
      candidate === version ||
      candidate.startsWith(`${version}-`) ||
      candidate.startsWith(`${version}.`),
  );
  if (!match) {
    throw new Error(
      `ArmFlang ${version} is not available from the configured Arm repository. ` +
        `Available package versions: ${versions.join(", ") || "none"}`,
    );
  }
  return match;
}

async function aptGetWithRetry(args: string[], maxAttempts = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const exitCode = await exec.exec(
      "sudo",
      ["apt-get", ...APT_ACQUIRE_OPTS, ...args],
      { ignoreReturnCode: true },
    );
    if (exitCode === 0) return;
    if (attempt === maxAttempts) {
      throw new Error(
        `apt-get ${args[0] ?? "command"} failed after ${maxAttempts.toString()} attempts ` +
          `with exit code ${exitCode.toString()}.`,
      );
    }
    const delayMs = attempt * 10_000;
    core.warning(
      `apt-get ${args[0] ?? "command"} failed ` +
        `(attempt ${attempt.toString()}/${maxAttempts.toString()}). ` +
        `Retrying in ${(delayMs / 1000).toString()} seconds...`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function restoreInstallationFromCache(cacheDir: string): Promise<void> {
  core.info("Restoring Arm Toolchain installation under /opt...");
  await exec.exec("sudo", ["rm", "-rf", INSTALL_DIR]);
  await exec.exec("sudo", ["mkdir", "-p", INSTALL_DIR]);
  await exec.exec("sudo", ["cp", "-a", `${cacheDir}/.`, INSTALL_DIR]);
}

async function stageInstallationForCache(cacheDir: string): Promise<void> {
  core.info("Staging Arm Toolchain installation for caching...");
  await exec.exec("sudo", ["rm", "-rf", cacheDir]);
  await exec.exec("sudo", ["mkdir", "-p", cacheDir]);
  await exec.exec("sudo", ["cp", "-a", `${INSTALL_DIR}/.`, cacheDir]);
  await exec.exec("sudo", ["chown", "-R", os.userInfo().username, cacheDir]);
}

export async function installDebian(
  inputs: Inputs,
): Promise<InstallationResult> {
  const version = resolveVersion(inputs, SUPPORTED_VERSIONS);
  const repository = ubuntuRepository(inputs.osVersion);
  const legacyBaseUrl =
    `https://developer.arm.com/packages/arm-toolchains:ubuntu-${repository.release}` +
    `/${repository.codename}`;
  const keyring = "/usr/share/keyrings/obs-oss-arm-com.gpg";
  const sourceList = "/etc/apt/sources.list.d/obs-oss-arm-com.list";
  const cacheDir = path.join(os.homedir(), ".armflang-cache");
  const cacheKey = `armflang-${version}-${inputs.arch}-${inputs.osVersion}`;

  core.info(`Installing ArmFlang ${version} on Linux (${inputs.arch})...`);
  const cacheHit = await cache.restoreCache([cacheDir], cacheKey);

  if (cacheHit) {
    core.info(`Cache hit for ${cacheKey}; skipping repository setup.`);
    await restoreInstallationFromCache(cacheDir);
  } else {
    await aptGetWithRetry(["update", "-y"]);
    await aptGetWithRetry(["install", "-y", "curl", "gpg"]);

    if (version === "22.1") {
      const repositoryPackage = `arm-toolchains-repository_2-1~${repository.codename}_all.deb`;
      const repositoryPackagePath = path.join(os.tmpdir(), repositoryPackage);
      try {
        await exec.exec("curl", [
          ...CURL_RETRY_ARGS,
          "-o",
          repositoryPackagePath,
          `https://developer.arm.com/packages/arm-toolchains/ubuntu/pool/${repositoryPackage}`,
        ]);
        await exec.exec("sudo", ["dpkg", "-i", repositoryPackagePath]);
      } finally {
        fs.rmSync(repositoryPackagePath, { force: true });
      }
    } else {
      const releaseKeyPath = path.join(
        os.tmpdir(),
        `arm-toolchains-${repository.codename}-Release.key`,
      );
      try {
        await exec.exec("curl", [
          ...CURL_RETRY_ARGS,
          "-o",
          releaseKeyPath,
          `${legacyBaseUrl}/Release.key`,
        ]);
        await exec.exec("sudo", [
          "gpg",
          "--dearmor",
          "--yes",
          "-o",
          keyring,
          releaseKeyPath,
        ]);
      } finally {
        fs.rmSync(releaseKeyPath, { force: true });
      }
      await exec.exec("sudo", [
        "sh",
        "-c",
        `echo "deb [signed-by=${keyring}] ${legacyBaseUrl}/ ./" > "${sourceList}"`,
      ]);
    }
    await aptGetWithRetry(["update", "-y"]);

    const packageVersion = await availablePackageVersion(version);
    await aptGetWithRetry([
      "install",
      "-y",
      "--no-install-recommends",
      "--fix-missing",
      `${PACKAGE}=${packageVersion}`,
    ]);

    await stageInstallationForCache(cacheDir);
    await cache.saveCache([cacheDir], cacheKey);
  }

  const binDir = path.join(INSTALL_DIR, "bin");
  const fc = path.join(binDir, "armflang");
  const cc = path.join(binDir, "armclang");
  const cxx = path.join(binDir, "armclang++");
  for (const binary of [fc, cc, cxx]) {
    if (!fs.existsSync(binary)) {
      throw new Error(`Expected Arm Toolchain binary was not found: ${binary}`);
    }
  }

  core.addPath(binDir);
  process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;

  let installedVersion = "";
  await exec.exec(fc, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        installedVersion += data.toString();
      },
    },
  });

  return {
    version: installedVersion.trim(),
    fc,
    cc,
    cxx,
  };
}
