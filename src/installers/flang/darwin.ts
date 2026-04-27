import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as fs from "fs";
import * as tc from "@actions/tool-cache";
import { Arch, LATEST } from "../../types";
import {
  resolveVersion,
  parseMajorOrPatch,
  resolveLatestPatch,
  verifyAssetExists,
} from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// LATEST (default) → install via Homebrew (always the freshest, no maintenance).
// Major or patch version → download from official LLVM GitHub releases.
//
// macOS asset naming on GitHub releases:
//   ARM64: LLVM-{patch}-macOS-ARM64.tar.xz  (available from at least 19+)
//   X64:   LLVM-{patch}-macOS-X64.tar.xz    (availability varies; verified at runtime)
//
// LATEST is listed first so it is the default when no version is specified.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: [LATEST, "19"],
  [Arch.ARM64]: [LATEST, "21", "20", "19"], // Only on macos-15+ runners
} as const satisfies Record<Arch, readonly string[]>;

// macOS asset suffix per arch in official LLVM GitHub releases.
const MACOS_ASSET_SUFFIX: Record<Arch, string> = {
  [Arch.X64]: "macOS-X64",
  [Arch.ARM64]: "macOS-ARM64",
};

export async function installDarwin(target: Target): Promise<string> {
  const resolved = resolveVersion(target, SUPPORTED_VERSIONS);

  if (resolved === LATEST) {
    return await installBrew(target);
  }

  // User specified a major or full patch version — use GitHub releases.
  const { major, patch: userPatch } = parseMajorOrPatch(resolved);

  let patch: string;
  if (userPatch !== undefined) {
    const filename = `LLVM-${userPatch}-${MACOS_ASSET_SUFFIX[target.arch]}.tar.xz`;
    await verifyAssetExists("llvm/llvm-project", userPatch, filename);
    patch = userPatch;
  } else {
    patch = await resolveLatestPatch("llvm/llvm-project", major);
  }

  return await installFromGitHub(target, major, patch);
}

// Installs flang via Homebrew. The `flang` formula is unversioned and always
// tracks the latest LLVM release. Any version input that resolved to LATEST
// ends up here.
async function installBrew(target: Target): Promise<string> {
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

  const flangBin = resolveFlangBinary(binDir);
  core.info(`Using flang binary: ${flangBin}`);

  const llvmBinDir = path.join(brewPrefix, "opt", "llvm", "bin");
  core.exportVariable("FC", flangBin);
  core.exportVariable("CC", path.join(llvmBinDir, "clang"));
  core.exportVariable("CXX", path.join(llvmBinDir, "clang++"));
  core.exportVariable("FORTRAN_COMPILER", "flang");
  core.exportVariable("FORTRAN_COMPILER_VERSION", LATEST);

  // libomp.dylib lives in the llvm formula's lib dir, not a standalone formula.
  const libDir = path.join(flangOptDir, "lib");
  const libompDir = path.join(brewPrefix, "opt", "llvm", "lib");
  const existingLibPath = process.env.LIBRARY_PATH ?? "";
  const libPaths = [libDir, libompDir].filter(fs.existsSync).join(":");
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
  core.info(
    `Flang ${resolvedVersion} installed successfully on macOS (Homebrew).`,
  );
  return resolvedVersion;
}

// Downloads and installs a specific flang version from official LLVM GitHub
// releases as a .tar.xz archive.
async function installFromGitHub(
  target: Target,
  major: string,
  patch: string,
): Promise<string> {
  const suffix = MACOS_ASSET_SUFFIX[target.arch];
  const filename = `LLVM-${patch}-${suffix}.tar.xz`;
  const downloadUrl = `https://github.com/llvm/llvm-project/releases/download/llvmorg-${patch}/${filename}`;

  core.info(
    `Installing Flang ${major} (${patch}) on macOS (${target.arch})...`,
  );

  // Key the cache on the full patch version so a new patch release always
  // triggers a fresh download rather than serving a stale cached binary.
  let toolRoot = tc.find("flang", patch, target.arch);

  if (!toolRoot) {
    core.info(`Downloading ${filename}...`);
    const downloadPath = await tc.downloadTool(downloadUrl);

    core.info("Extracting archive...");
    // The archive has a single top-level directory; strip it so toolRoot is
    // directly the install dir containing bin/, lib/, etc.
    const extractPath = await tc.extractTar(downloadPath, undefined, [
      "xJ",
      "--strip-components=1",
    ]);

    core.info("Caching...");
    toolRoot = await tc.cacheDir(extractPath, "flang", patch, target.arch);
  } else {
    core.info(
      `Flang ${patch} found in tool cache at ${toolRoot}, skipping download.`,
    );
  }

  const binDir = path.join(toolRoot, "bin");
  core.addPath(binDir);

  const flangBin = resolveFlangBinary(binDir);
  core.info(`Using flang binary: ${flangBin}`);

  const libDir = path.join(toolRoot, "lib");
  const existingLibPath = process.env.LIBRARY_PATH ?? "";
  core.exportVariable(
    "LIBRARY_PATH",
    existingLibPath ? `${libDir}:${existingLibPath}` : libDir,
  );

  core.exportVariable("FC", flangBin);
  core.exportVariable("CC", path.join(binDir, "clang"));
  core.exportVariable("CXX", path.join(binDir, "clang++"));
  core.exportVariable("FORTRAN_COMPILER", "flang");
  core.exportVariable("FORTRAN_COMPILER_VERSION", major);

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
  core.info(
    `Flang ${resolvedVersion} installed successfully on macOS (GitHub releases).`,
  );
  return resolvedVersion;
}

// Probes for the flang binary name in the given bin dir.
// LLVM 20+ uses `flang`; earlier versions used `flang-new`.
function resolveFlangBinary(binDir: string): string {
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
