import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import { Arch, LATEST } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// macOS support notes:
//
//   ARM64 (macos-14 sonoma, macos-15 sequoia, macos-26 tahoe):
//     `brew install flang` installs prebuilt bottles on all three. Supported.
//
//   Intel x64 (macos-15-intel sequoia, macos-26-intel tahoe):
//     The flang Homebrew formula has a prebuilt Intel bottle for Sonoma only.
//     Sequoia and Tahoe have no Intel bottle; installation would require
//     building LLVM from source (~hours). Not viable in CI.
//
// Version selection is not possible on macOS: the `flang` formula is
// unversioned and always tracks the latest LLVM release. The versioned
// `llvm@N` formulae exist but do not include flang as a built component.
// Any version input is accepted and silently ignored; an info message
// explains this so users copying a Linux workflow aren't surprised.
const SUPPORTED_VERSIONS = {
  [Arch.ARM64]: [LATEST],
  [Arch.X64]: [LATEST],
} as const satisfies Record<Arch, readonly string[] | undefined>;

export async function installDarwin(target: Target): Promise<string> {
  // if (target.arch === Arch.X64) {
  //   throw new Error(
  //     `Flang is not supported on Intel macOS runners (macos-15-intel, macos-26-intel). ` +
  //       `The Homebrew flang formula has no prebuilt bottle for Intel on macOS 15 (sequoia) ` +
  //       `or macOS 26 (tahoe), and building LLVM from source is not viable in CI. ` +
  //       `Use an ARM64 runner instead (macos-14, macos-15, macos-26).`,
  //   );
  // }

  resolveVersion(target, SUPPORTED_VERSIONS);

  core.info(`Installing Flang on macOS (${target.arch}) via Homebrew...`);
  core.info(
    `Note: the Homebrew flang formula is unversioned — the latest available ` +
      `release will be installed regardless of any version input.`,
  );

  await exec.exec("brew", ["install", "flang"]);

  const brewPrefix = await getBrewPrefix();
  const flangOptDir = path.join(brewPrefix, "opt", "flang");
  const binDir = path.join(flangOptDir, "bin");

  core.addPath(binDir);

  const flangBin = await resolveFlangBinary(binDir);
  core.info(`Using flang binary: ${flangBin}`);

  const llvmBinDir = path.join(brewPrefix, "opt", "llvm", "bin");
  core.exportVariable("FC", flangBin);
  core.exportVariable("CC", path.join(llvmBinDir, "clang"));
  core.exportVariable("CXX", path.join(llvmBinDir, "clang++"));

  const libDir = path.join(flangOptDir, "lib");
  const existingLibPath = process.env.LIBRARY_PATH ?? "";
  core.exportVariable(
    "LIBRARY_PATH",
    existingLibPath ? `${libDir}:${existingLibPath}` : libDir,
  );

  let sdkPath = "";
  try {
    await exec.exec("xcrun", ["--show-sdk-path"], {
      listeners: {
        stdout: (data: Buffer) => {
          sdkPath += data.toString().trim();
        },
      },
    });
    if (sdkPath) core.exportVariable("SDKROOT", sdkPath);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    core.warning(`Could not determine SDKROOT via xcrun: ${error}`);
  }

  const resolvedVersion = await resolveInstalledVersion(flangBin);
  core.info(`Flang ${resolvedVersion} installed successfully on macOS.`);
  return resolvedVersion;
}

async function resolveFlangBinary(binDir: string): Promise<string> {
  const fs = await import("fs");
  for (const name of ["flang", "flang-new"]) {
    const candidate = path.join(binDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Could not find flang binary in ${binDir}. Checked: flang, flang-new.`,
  );
}

async function getBrewPrefix(): Promise<string> {
  let output = "";
  await exec.exec("brew", ["--prefix"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}

async function resolveInstalledVersion(flangBin: string): Promise<string> {
  let output = "";
  await exec.exec(flangBin, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
