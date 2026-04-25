import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// Notes:
//   - Only major versions are meaningful here: neither llvm.sh nor the apt
//     repository accept minor/patch versions, so the installed patch is always
//     whatever the LLVM apt repo currently serves for that major.
//   - LLVM 17 introduced the F18-based rewrite shipped as `flang-new`.
//     Versions <= 16 ship the classic Flang binary as `flang`.
//   - LLVM 22 is in pre-release as of early 2026.
// ARM64 is fully supported via the official LLVM apt repository.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["22", "21", "20", "19", "18", "17", "16", "15"],
  [Arch.ARM64]: ["22", "21", "20", "19", "18", "17", "16", "15"],
} as const satisfies Record<Arch, readonly string[]>;

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);

  core.info(`Installing Flang ${version} on Linux (${target.arch})...`);

  core.info(`Adding LLVM ${version} apt repository via apt.llvm.org...`);
  await exec.exec("bash", [
    "-c",
    [
      `curl -fsSL https://apt.llvm.org/llvm.sh`,
      `| sudo bash -s -- ${version}`,
    ].join(" "),
  ]);

  const pkgName = `flang-${version}`;
  core.info(`Installing apt package ${pkgName}...`);
  await exec.exec("sudo", ["apt-get", "install", "-y", pkgName]);

  // Register the versioned binary under the generic `flang` name via
  // update-alternatives so that users can always call `flang` regardless of
  // which LLVM major is installed. For LLVM >= 17 the on-disk binary is named
  // `flang-new-<version>`; for <= 16 it is `flang-<version>`.
  const versionedBin =
    parseInt(version, 10) >= 17
      ? `/usr/bin/flang-new-${version}`
      : `/usr/bin/flang-${version}`;

  await exec.exec("sudo", [
    "update-alternatives",
    "--install",
    "/usr/bin/flang",
    "flang",
    versionedBin,
    "100",
  ]);

  core.exportVariable("FC", "flang");
  core.exportVariable("CC", `clang-${version}`);
  core.exportVariable("CXX", `clang++-${version}`);

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`Flang ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("flang", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
