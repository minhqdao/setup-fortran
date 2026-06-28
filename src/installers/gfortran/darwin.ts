import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import { Arch, type InstallationResult } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["16", "15", "14", "13", "12", "11"],
  [Arch.ARM64]: ["16", "15", "14", "13", "12", "11"],
} as const satisfies Record<Arch, readonly string[]>;

export async function installDarwin(
  target: Target,
): Promise<InstallationResult> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  core.info(
    `Installing GFortran ${version} on macOS (${target.arch}) via Homebrew...`,
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

  const gccBinary = path.join(binDir, `gcc-${version}`);
  const gxxBinary = path.join(binDir, `g++-${version}`);

  const resolvedVersion = await resolveInstalledVersion();
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
