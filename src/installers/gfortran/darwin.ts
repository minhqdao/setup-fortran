import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["16", "15", "14", "13", "12", "11"],
  [Arch.ARM64]: ["16", "15", "14", "13", "12", "11"],
} as const satisfies Record<Arch, readonly string[]>;

export async function installDarwin(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  core.info(
    `Installing GFortran ${version} on macOS (${target.arch}) via Homebrew...`,
  );

  const formula = await resolveFormula(version);

  const alreadyInstalled = await isCorrectVersionInstalled(formula, version);

  if (alreadyInstalled) {
    core.info(
      `${formula} ${version} is already installed, skipping brew install.`,
    );
  } else {
    await exec.exec("brew", ["install", formula]);
  }

  const brewPrefix = await getBrewPrefix();

  let cellarPrefix = "";
  await exec.exec("brew", ["--prefix", formula], {
    listeners: {
      stdout: (data: Buffer) => (cellarPrefix += data.toString().trim()),
    },
  });

  // Find the actual library directory dynamically and cast a wide symlink net
  const brewLibDir = path.join(brewPrefix, "lib");
  const expectedDyldDir = path.join(cellarPrefix, "lib", "gcc", version);

  await exec.exec("bash", [
    "-c",
    `
    # 1. Find the actual directory containing libgfortran within the cellar
    ACTUAL_LIB_DIR=$(find "${cellarPrefix}/lib/gcc" -name "libgfortran*.dylib" -exec dirname {} \\; | head -n 1)

    if [ -n "$ACTUAL_LIB_DIR" ]; then
      echo "Found libgfortran in $ACTUAL_LIB_DIR"

      # 2. Satisfy fpm's hardcoded dyld path if Homebrew put it somewhere else (like 'current')
      if [ "$ACTUAL_LIB_DIR" != "${expectedDyldDir}" ]; then
         sudo mkdir -p "${expectedDyldDir}"
         sudo ln -sf "$ACTUAL_LIB_DIR"/lib*.dylib "${expectedDyldDir}"/
      fi

      # 3. Symlink to brew's standard lib dir
      ln -sf "$ACTUAL_LIB_DIR"/lib*.dylib "${brewLibDir}"/

      # 4. Provide the ultimate fallback for dyld (SIP safe)
      sudo mkdir -p /usr/local/lib
      sudo ln -sf "$ACTUAL_LIB_DIR"/lib*.dylib /usr/local/lib/
    else
      echo "WARNING: Could not find libgfortran in ${cellarPrefix}"
    fi
    `,
  ]);

  const existingLibraryPath = process.env.LIBRARY_PATH ?? "";

  const binDir = path.join(brewPrefix, "bin");
  const gfortranBinary = path.join(binDir, `gfortran-${version}`);
  const genericGfortran = path.join(binDir, "gfortran");

  core.info(`Symlinking ${gfortranBinary} to ${genericGfortran}`);

  await exec.exec("ln", ["-sf", gfortranBinary, genericGfortran]);

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
        existingLibraryPath
          ? `${sdkPath}/usr/lib:${existingLibraryPath}`
          : `${sdkPath}/usr/lib`,
      );
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    core.warning(`Could not determine SDKROOT path via xcrun. Err: ${error}`);
  }

  core.info(`Setting FC, F77, and F90 environment variables...`);
  core.exportVariable("FC", gfortranBinary);
  core.exportVariable("F77", gfortranBinary);
  core.exportVariable("F90", gfortranBinary);

  const gccBinary = path.join(binDir, `gcc-${version}`);
  const gxxBinary = path.join(binDir, `g++-${version}`);
  core.exportVariable("CC", gccBinary);
  core.exportVariable("CXX", gxxBinary);
  core.exportVariable("FPM_FC", gfortranBinary);
  core.exportVariable("FPM_CC", gccBinary);
  core.exportVariable("FPM_CXX", gxxBinary);

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`GFortran ${resolvedVersion} installed successfully on Darwin.`);
  return resolvedVersion;
}

async function resolveFormula(version: string): Promise<string> {
  const versionedFormula = `gcc@${version}`;
  let infoOutput = "";

  const exitCode = await exec.exec(
    "brew",
    ["info", "--json=v2", versionedFormula],
    {
      silent: true,
      listeners: { stdout: (data: Buffer) => (infoOutput += data.toString()) },
      ignoreReturnCode: true,
    },
  );

  if (exitCode === 0) {
    return versionedFormula;
  }

  core.info(
    `${versionedFormula} not found as a distinct formula, falling back to "gcc".`,
  );
  return "gcc";
}

async function isCorrectVersionInstalled(
  formula: string,
  version: string,
): Promise<boolean> {
  let infoOutput = "";
  const exitCode = await exec.exec("brew", ["info", "--json=v2", formula], {
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        infoOutput += data.toString();
      },
    },
    ignoreReturnCode: true,
  });

  if (exitCode !== 0 || !infoOutput.trim()) return false;

  try {
    const info = JSON.parse(infoOutput) as {
      formulae: { installed: { version: string }[] }[];
    };

    const installedVersions = info.formulae[0]?.installed ?? [];
    if (installedVersions.length === 0) return false;

    return installedVersions.some((v) => v.version.split(".")[0] === version);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    core.warning(`Failed to parse brew info output for ${formula}: ${message}`);
    return false;
  }
}

async function getBrewPrefix(): Promise<string> {
  let output = "";
  await exec.exec("brew", ["--prefix"], {
    listeners: { stdout: (data: Buffer) => (output += data.toString()) },
  });
  return output.trim();
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("gfortran", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
