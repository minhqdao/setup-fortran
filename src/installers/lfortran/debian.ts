import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// Notes:
//   - lfortran is installed via conda-forge, so the version here is the conda
//     package version (e.g. "0.63.0").
//   - conda-forge only publishes lfortran for linux-64; linux-aarch64 is
//     currently not supported (https://anaconda.org/conda-forge/lfortran).
//   - The binary is always named `lfortran` regardless of version.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: [
    "0.63.0",
    "0.62.0",
    "0.61.0",
    "0.60.0",
    "0.59.0",
    "0.58.0",
    "0.57.0",
  ],
} as const satisfies Partial<Record<Arch, readonly string[]>>;

// Downloads and installs a self-contained Miniforge installer into a temporary
// prefix, then uses it to create a conda env with lfortran from conda-forge.
//
// We avoid installing into $CONDA_PREFIX or any pre-existing conda environment
// to prevent interference with other runner toolchains.
export async function installDebian(target: Target): Promise<string> {
  if (target.arch === Arch.ARM64) {
    throw new Error(
      `LFortran is not available for Linux ARM64 on conda-forge. ` +
        `See https://anaconda.org/conda-forge/lfortran for supported platforms.`,
    );
  }

  const version = resolveVersion(target, SUPPORTED_VERSIONS);

  core.info(`Installing LFortran ${version} on Linux (${target.arch})...`);

  // Install Miniforge into a dedicated prefix under the runner's temp dir.
  // Using a fixed path makes it easy to add to PATH later.
  const condaPrefix = path.join(os.tmpdir(), "lfortran-conda");
  const miniforgeInstaller = path.join(os.tmpdir(), "miniforge.sh");

  const miniforgeUrl = `https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh`;

  core.info(`Downloading Miniforge from ${miniforgeUrl}...`);
  await exec.exec("curl", [
    "-fsSL",
    "--retry",
    "3",
    "--retry-delay",
    "15",
    "-o",
    miniforgeInstaller,
    miniforgeUrl,
  ]);

  core.info(`Installing Miniforge to ${condaPrefix}...`);
  await exec.exec("bash", [
    miniforgeInstaller,
    "-b", // batch mode, no interactive prompts
    "-p",
    condaPrefix,
  ]);

  // Point conda at conda-forge only, to avoid the default channel.
  const condaBin = path.join(condaPrefix, "bin", "conda");
  await exec.exec(condaBin, ["config", "--set", "channel_priority", "strict"]);

  core.info(`Installing lfortran==${version} from conda-forge...`);
  await exec.exec(condaBin, [
    "install",
    "-y",
    "-c",
    "conda-forge",
    `lfortran==${version}`,
  ]);

  // The lfortran binary lives in the conda prefix's bin directory.
  const lfortranBinDir = path.join(condaPrefix, "bin");
  const lfortranBin = path.join(lfortranBinDir, "lfortran");

  if (!fs.existsSync(lfortranBin)) {
    throw new Error(
      `lfortran binary not found at expected path: ${lfortranBin}`,
    );
  }

  core.info(`Found lfortran binary at: ${lfortranBin}`);

  core.addPath(lfortranBinDir);

  core.exportVariable("FC", "lfortran");
  core.exportVariable("CC", "clang");
  core.exportVariable("CXX", "clang++");
  core.exportVariable("FPM_FC", "lfortran");
  core.exportVariable("FPM_CC", "clang");
  core.exportVariable("FPM_CXX", "clang++");
  core.exportVariable("LFORTRAN_OMP_LIB_DIR", path.join(condaPrefix, "lib"));

  const resolvedVersion = await resolveInstalledVersion(lfortranBin);
  core.info(`LFortran ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(binaryPath: string): Promise<string> {
  let output = "";
  await exec.exec(binaryPath, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
