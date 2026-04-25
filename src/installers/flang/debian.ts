import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
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
//   - ARM64: LLVM 15/16 apt repos were never published for noble (24.04), and
//     on jammy (22.04) the classic Flang package does not install a versioned
//     binary in /usr/bin, only the bare `flang` binary. Both issues are moot
//     for >= 17, which ships correctly on all supported Ubuntu releases.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["22", "21", "20", "19", "18", "17", "16", "15", "14", "13"],
  [Arch.ARM64]: ["22", "21", "20", "19", "18", "17"],
} as const satisfies Record<Arch, readonly string[]>;

// Starting from LLVM 17 the rewritten Flang ships as `flang-new`.
// Classic Flang (<= 16) used just `flang`.
function flangBinary(version: string): "flang-new" | "flang" {
  return parseInt(version, 10) >= 17 ? "flang-new" : "flang";
}

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
  // which LLVM major is installed.
  //
  // Preferred target: the versioned binary (e.g. `flang-new-18`, `flang-16`).
  // Fallback: the unversioned binary (e.g. `flang-new`, `flang`). Older LLVM
  // packages on arm64 did not install versioned symlinks in /usr/bin, so we
  // probe first and use whatever is actually present.
  const major = parseInt(version, 10);
  const versionedBin =
    major >= 17 ? `/usr/bin/flang-new-${version}` : `/usr/bin/flang-${version}`;
  const unversionedBin = major >= 17 ? `/usr/bin/flang-new` : `/usr/bin/flang`;

  const alternativePath = fs.existsSync(versionedBin)
    ? versionedBin
    : unversionedBin;
  core.info(`Registering update-alternatives using ${alternativePath}...`);

  await exec.exec("sudo", [
    "update-alternatives",
    "--install",
    "/usr/bin/flang",
    "flang",
    alternativePath,
    "100",
  ]);

  core.exportVariable("FC", "flang");
  core.exportVariable("CC", `clang-${version}`);
  core.exportVariable("CXX", `clang++-${version}`);

  const resolvedVersion = await resolveInstalledVersion(version);
  core.info(`Flang ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(version: string): Promise<string> {
  let output = "";
  const binary = flangBinary(version);
  await exec.exec(binary, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
