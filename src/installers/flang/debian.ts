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
//   - ARM64 on jammy (22.04): LLVM 15/16 packages exist but do not install a
//     versioned binary in /usr/bin, only the bare `flang` binary, causing
//     update-alternatives to fail. Excluded from arm64 support.
//   - ARM64 on noble (24.04): LLVM 15/16 apt repos were never published.
//     Excluded for the same reason.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["22", "21", "20", "19", "18", "17", "16", "15", "14"],
  [Arch.ARM64]: ["22", "21", "20", "19", "18", "17", "16", "15", "14"],
} as const satisfies Record<Arch, readonly string[]>;

// Returns the Ubuntu codename (e.g. "jammy", "noble").
async function getUbuntuCodename(): Promise<string> {
  let output = "";
  await exec.exec("lsb_release", ["-cs"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  const major = parseInt(version, 10);

  // LLVM 15/16 apt repos were never published for noble (24.04) on either
  // arch. Catch this early with a clear error rather than a confusing apt
  // failure mid-install.
  if (major <= 16) {
    const codename = await getUbuntuCodename();
    if (codename === "noble") {
      throw new Error(
        `Flang ${version} is not available on Ubuntu 24.04 (noble): ` +
          `apt.llvm.org has no repository for llvm-toolchain-noble-${version}. ` +
          `Use LLVM 17 or later on Ubuntu 24.04.`,
      );
    }
  }

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

  // Binaries live under /usr/lib/llvm-<version>/bin/ which is stable and
  // version-isolated, regardless of what symlinks are (or aren't) created in
  // /usr/bin by the package. This avoids the self-symlink failure that occurs
  // when older packages drop a bare `flang` in /usr/bin without a versioned
  // counterpart.
  const llvmBinDir = `/usr/lib/llvm-${version}/bin`;
  const binaryName = major >= 17 ? "flang-new" : "flang";
  const binaryPath = `${llvmBinDir}/${binaryName}`;

  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `Flang binary not found at expected path: ${binaryPath}. ` +
        `The package may not include flang for this platform.`,
    );
  }

  // Register the versioned binary under the generic `flang` name so that
  // users can always call `flang` regardless of which LLVM major is installed.
  core.info(`Registering update-alternatives: /usr/bin/flang -> ${binaryPath}`);
  await exec.exec("sudo", [
    "update-alternatives",
    "--install",
    "/usr/bin/flang",
    "flang",
    binaryPath,
    "100",
  ]);

  // Also add the llvm bin dir to PATH so that other versioned tools
  // (e.g. flang-new-22, clang-22) are reachable without qualification.
  core.addPath(llvmBinDir);

  core.exportVariable("FC", "flang");
  core.exportVariable("CC", `clang-${version}`);
  core.exportVariable("CXX", `clang++-${version}`);

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`Flang ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  // By this point /usr/bin/flang is set up via update-alternatives, so we
  // can always call the unversioned `flang` binary.
  await exec.exec("flang", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
