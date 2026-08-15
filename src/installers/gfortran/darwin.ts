import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import { Arch, type InstallationResult } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Inputs } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["16", "15", "14", "13", "12", "11"],
  [Arch.ARM64]: ["16", "15", "14", "13", "12", "11"],
} as const satisfies Record<Arch, readonly string[]>;

export async function installDarwin(
  inputs: Inputs,
): Promise<InstallationResult> {
  const version = resolveVersion(inputs, SUPPORTED_VERSIONS);
  core.info(
    `Installing GFortran ${version} on macOS (${inputs.arch}) via Homebrew...`,
  );

  const formula = `gcc@${version}`;

  let listOutput = "";
  await exec.exec("brew", ["list", "--versions", formula], {
    listeners: {
      stdout: (data: Buffer) => {
        listOutput += data.toString();
      },
    },
    ignoreReturnCode: true,
  });
  const alreadyInstalled = listOutput.trim().length > 0;

  if (alreadyInstalled) {
    core.info(`${formula} is already installed, skipping brew install.`);
  } else {
    const infoExitCode = await exec.exec("brew", ["info", formula], {
      ignoreReturnCode: true,
    });

    if (infoExitCode !== 0) {
      core.info(`${formula} not found in local index, running brew update...`);
      await exec.exec("brew", ["update"]);
    }

    // Add --skip-post-install to ensure the hook failure doesn't crash the CI
    await exec.exec("brew", ["install", "--skip-post-install", formula]);
  }

  const brewPrefix = await getBrewPrefix();

  let cellarPrefix = "";
  await exec.exec("brew", ["--prefix", `gcc@${version}`], {
    listeners: {
      stdout: (data: Buffer) => (cellarPrefix += data.toString().trim()),
    },
  });

  let actualLibDir = "";
  await exec.exec(
    "bash",
    [
      "-c",
      `find "${cellarPrefix}/lib/gcc" -name "libgfortran*.dylib" -exec dirname {} \\; | head -n 1`,
    ],
    {
      listeners: {
        stdout: (data: Buffer) => {
          actualLibDir += data.toString().trim();
        },
      },
    },
  );
  if (!actualLibDir) {
    throw new Error(`Could not find libgfortran in ${cellarPrefix}.`);
  }

  const existingLibraryPath = process.env.LIBRARY_PATH ?? "";

  const binDir = path.join(brewPrefix, "bin");
  const gfortranBinary = path.join(binDir, `gfortran-${version}`);
  const existingDyldPath = process.env.DYLD_FALLBACK_LIBRARY_PATH ?? "";
  core.exportVariable(
    "DYLD_FALLBACK_LIBRARY_PATH",
    existingDyldPath ? `${actualLibDir}:${existingDyldPath}` : actualLibDir,
  );

  // Help ld find -lSystem on newer macOS versions
  let sdkPath = "";
  try {
    await exec.exec("xcrun", ["--show-sdk-path"], {
      listeners: {
        stdout: (data: Buffer) => (sdkPath += data.toString().trim()),
      },
    });
    if (sdkPath) {
      core.exportVariable("SDKROOT", sdkPath);
      core.exportVariable(
        "LIBRARY_PATH",
        [`${sdkPath}/usr/lib`, existingLibraryPath].filter(Boolean).join(":"),
      );
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    core.warning(`Could not determine SDKROOT path via xcrun. Err: ${error}`);
  }

  const gccBinary = path.join(binDir, `gcc-${version}`);
  const gxxBinary = path.join(binDir, `g++-${version}`);

  const resolvedVersion = await resolveInstalledVersion(gfortranBinary);
  core.info(`GFortran ${resolvedVersion} installed successfully on Darwin.`);
  const result = {
    version: resolvedVersion,
    fc: gfortranBinary,
    cc: gccBinary,
    cxx: gxxBinary,
  };
  return result;
}

async function getBrewPrefix(): Promise<string> {
  let output = "";
  await exec.exec("brew", ["--prefix"], {
    listeners: { stdout: (data: Buffer) => (output += data.toString()) },
  });
  return output.trim();
}

async function resolveInstalledVersion(binary: string): Promise<string> {
  let output = "";
  await exec.exec(binary, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
