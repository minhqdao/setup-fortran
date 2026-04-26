import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as path from "path";
import { Arch, LATEST } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// macOS support notes:
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
  const libompDir = path.join(brewPrefix, "opt", "libomp", "lib");
  const existingLibPath = process.env.LIBRARY_PATH ?? "";
  const libPaths = [libDir, libompDir].filter(fs.existsSync).join(":");

  core.info(`DEBUG: libPaths = "${libPaths}"`);
  if (libPaths) {
    core.exportVariable(
      "LIBRARY_PATH",
      existingLibPath ? `${libPaths}:${existingLibPath}` : libPaths,
    );
  }
  core.info(`DEBUG: libDir exists: ${fs.existsSync(libDir).toString()}`);
  core.info(`DEBUG: libompDir exists: ${fs.existsSync(libompDir).toString()}`);
  const optDir = path.join(brewPrefix, "opt");
  for (const formula of fs.readdirSync(optDir)) {
    if (
      formula.toLowerCase().includes("omp") ||
      formula.toLowerCase().includes("llvm")
    ) {
      core.info(`DEBUG: found formula: ${formula}`);
      const fLib = path.join(optDir, formula, "lib");
      if (fs.existsSync(fLib)) {
        for (const f of fs.readdirSync(fLib)) {
          if (f.toLowerCase().includes("omp"))
            core.info(`  DEBUG: ${fLib}/${f}`);
        }
      }
    }
  }

  core.exportVariable(
    "LIBRARY_PATH",
    existingLibPath ? `${libPaths}:${existingLibPath}` : libPaths,
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
