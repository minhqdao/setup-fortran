import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["15", "14", "13", "12", "11"],
  [Arch.ARM64]: ["15", "14", "13", "12", "11"],
} as const satisfies Record<Arch, readonly string[]>;

export async function installDarwin(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  core.info(
    `Installing GFortran ${version} on macOS (${target.arch}) via Homebrew...`,
  );

  const formula = `gcc@${version}`;

  await exec.exec("brew", ["install", formula]);

  // Homebrew usually installs to /opt/homebrew/bin (ARM) or /usr/local/bin (x64)
  const brewPrefixOutput = await getBrewPrefix();
  const binDir = path.join(brewPrefixOutput, "bin");
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
      // Also helpful for some older C-interop scenarios:
      core.exportVariable("LIBRARY_PATH", `${sdkPath}/usr/lib`);
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    core.warning(`Could not determine SDKROOT path via xcrun. Err: ${error}`);
  }

  core.info(`Setting FC, F77, and F90 environment variables...`);
  core.exportVariable("FC", gfortranBinary);
  core.exportVariable("F77", gfortranBinary);
  core.exportVariable("F90", gfortranBinary);

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`GFortran ${resolvedVersion} installed successfully on Darwin.`);
  return resolvedVersion;
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
