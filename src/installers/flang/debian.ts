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
//   - ARM64: LLVM 15/16 have no noble (24.04) repo and broken jammy (22.04)
//     packaging. 17 is the effective floor on arm64.
//   - X64: LLVM 15/16 are available on jammy (22.04) only. Noble (24.04) has
//     no repo for these versions; caught below with an early error.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["22", "21", "20", "19", "18", "17", "16", "15"],
  [Arch.ARM64]: ["22", "21", "20", "19", "18", "17"],
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

// Resolves the on-disk path of the flang binary for the given major version.
// LLVM packages are inconsistent about where they install the binary:
//   - LLVM >= 17: reliably at /usr/lib/llvm-<version>/bin/flang-new
//   - LLVM <= 16: should be at /usr/lib/llvm-<version>/bin/flang, but older
//     or arm64 packages may only drop a bare /usr/bin/flang with no versioned
//     counterpart anywhere.
// We probe in preference order and throw if nothing is found.
function resolveFlangBinaryPath(major: number, version: string): string {
  const candidates =
    major >= 17
      ? [`/usr/lib/llvm-${version}/bin/flang-new`]
      : [
          `/usr/lib/llvm-${version}/bin/flang`,
          `/usr/bin/flang-${version}`,
          `/usr/bin/flang`,
        ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Flang binary not found in any expected location for LLVM ${version}: ` +
      candidates.join(", "),
  );
}

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  const major = parseInt(version, 10);

  // LLVM 15/16 apt repos were never published for noble (24.04).
  // Catch this early with a clear error rather than a confusing apt failure.
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

  const binaryPath = resolveFlangBinaryPath(major, version);
  core.info(`Registering update-alternatives: /usr/bin/flang -> ${binaryPath}`);

  // Skip registration if /usr/bin/flang is the binary itself (bare install
  // with no versioned counterpart) — update-alternatives forbids link == path.
  if (binaryPath !== "/usr/bin/flang") {
    await exec.exec("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      binaryPath,
      "100",
    ]);
  }

  // Add the llvm bin dir to PATH so versioned tools (clang-22, etc.) are
  // reachable in subsequent steps without qualification.
  const llvmBinDir = `/usr/lib/llvm-${version}/bin`;
  if (fs.existsSync(llvmBinDir)) {
    core.addPath(llvmBinDir);
  }

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
