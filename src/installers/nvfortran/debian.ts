import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
// Version scheme: YY.M (e.g. "26.1" = January 2026).
// Releases ship roughly every two months; only LTS-ish ones listed here.
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
  ],
} as const satisfies Record<Arch, readonly string[]>;

const APT_ARCH: Record<Arch, string> = {
  [Arch.X64]: "amd64",
  [Arch.ARM64]: "arm64",
};

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  const aptArch = APT_ARCH[target.arch];

  core.info(`Installing nvfortran ${version} on Linux (${target.arch})...`);

  // Add the NVIDIA HPC SDK apt repository if not already present.
  // Key URL: https://developer.download.nvidia.com/hpc-sdk/ubuntu/DEB-GPG-KEY-NVIDIA-HPC-SDK
  // Repo URL: https://developer.download.nvidia.com/hpc-sdk/ubuntu/{amd64|arm64}
  core.info("Adding NVIDIA HPC SDK apt repository...");
  await exec.exec("bash", [
    "-c",
    [
      `curl -fsSL https://developer.download.nvidia.com/hpc-sdk/ubuntu/DEB-GPG-KEY-NVIDIA-HPC-SDK`,
      `| sudo gpg --dearmor -o /usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg`,
    ].join(" "),
  ]);
  await exec.exec("bash", [
    "-c",
    `echo 'deb [signed-by=/usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg] https://developer.download.nvidia.com/hpc-sdk/ubuntu/${aptArch} /' | sudo tee /etc/apt/sources.list.d/nvhpc.list`,
  ]);

  await exec.exec("sudo", ["apt-get", "update", "-y"]);

  // Package name format: nvhpc-YY-M  (dots replaced by dashes, no leading zeros)
  // e.g. "26.1" -> "nvhpc-26-1", "25.11" -> "nvhpc-25-11"
  const pkgVersion = version.replace(".", "-");
  const pkgName = `nvhpc-${pkgVersion}`;

  core.info(`Installing apt package ${pkgName}...`);
  await exec.exec("sudo", [
    "apt-get",
    "install",
    "-y",
    "--no-install-recommends",
    pkgName,
  ]);

  // NVIDIA installs into /opt/nvidia/hpc_sdk/<arch>/<version>/compilers/bin
  // arch directory matches uname -s_uname -m convention: Linux_x86_64 / Linux_aarch64
  const nvArch = target.arch === Arch.X64 ? "Linux_x86_64" : "Linux_aarch64";
  const installDir = `/opt/nvidia/hpc_sdk/${nvArch}/${version}`;
  const binDir = `${installDir}/compilers/bin`;

  core.info(`Adding ${binDir} to PATH...`);
  core.addPath(binDir);

  core.exportVariable("FC", "nvfortran");
  core.exportVariable("CC", "nvc");
  core.exportVariable("CXX", "nvc++");

  // Make math/comm libraries findable at runtime.
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
