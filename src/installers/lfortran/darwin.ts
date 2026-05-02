import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// Notes:
//   - lfortran is installed via conda-forge on macOS; there is no Homebrew
//     formula and GitHub releases only ship source tarballs.
//   - Both ARM64 (macos-14+) and X64 (macos-13 and earlier) are supported via
//     conda-forge. The conda arch strings are `osx-arm64` and `osx-64`.
//   - LATEST resolves to the first entry in the list.
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
  [Arch.ARM64]: [
    "0.63.0",
    "0.62.0",
    "0.61.0",
    "0.60.0",
    "0.59.0",
    "0.58.0",
    "0.57.0",
  ],
} as const satisfies Record<Arch, readonly string[]>;

// Returns the conda arch string for a given runner arch.
function condaArch(arch: Arch): string {
  switch (arch) {
    case Arch.X64:
      return "x86_64";
    case Arch.ARM64:
      return "arm64";
  }
}

export async function installDarwin(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);

  core.info(`Installing LFortran ${version} on macOS (${target.arch})...`);

  // Install Miniforge into a dedicated prefix under the runner's temp dir to
  // avoid interfering with any pre-existing conda installation on the runner.
  const condaPrefix = path.join(os.tmpdir(), "lfortran-conda");
  const miniforgeInstaller = path.join(os.tmpdir(), "miniforge.sh");
  const arch = condaArch(target.arch);

  const miniforgeUrl = `https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-MacOSX-${arch}.sh`;

  core.info(`Downloading Miniforge from ${miniforgeUrl}...`);
  await exec.exec("curl", ["-fsSL", "-o", miniforgeInstaller, miniforgeUrl]);

  core.info(`Installing Miniforge to ${condaPrefix}...`);
  await exec.exec("bash", [
    miniforgeInstaller,
    "-b", // batch mode, no interactive prompts
    "-p",
    condaPrefix,
  ]);

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
  core.exportVariable("FORTRAN_COMPILER", "lfortran");
  core.exportVariable("FORTRAN_COMPILER_VERSION", version);
  core.exportVariable("LFORTRAN_OMP_LIB_DIR", path.join(condaPrefix, "lib"));

  // lfortran links against system libc++ on macOS; set SDKROOT so the linker
  // can find the right SDK headers when compiling generated C/C++ code.
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

  const resolvedVersion = await resolveInstalledVersion(lfortranBin);
  core.info(`LFortran ${resolvedVersion} installed successfully on macOS.`);
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
