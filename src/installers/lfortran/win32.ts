import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { Arch, LATEST, WindowsEnv, type Target } from "../../types";
import { resolveWindowsVersion } from "../../resolve_version";
import { setupMSYS2 } from "../../setup_msys2";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// Native (conda-forge, default):
//   Both x64 and ARM64. Conda-forge is the only source that provides current
//   versioned lfortran binaries for Windows. The Miniforge installer is a
//   native .exe that runs without MSYS2 or WSL.
//
// UCRT64 (MSYS2/pacman, rolling release):
//   x64 only — MSYS2 does not support ARM64. Version is always LATEST since
//   pacman tracks the rolling release. The UCRT64 lfortran package tracks
//   upstream closely (verified at 0.63.0).
const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [WindowsEnv.Native]: ["0.63.0", "0.62.0", "0.61.0", "0.60.0", "0.59.0"],
    [WindowsEnv.UCRT64]: [LATEST],
  },
  [Arch.ARM64]: {
    [WindowsEnv.Native]: ["0.63.0", "0.62.0", "0.61.0", "0.60.0", "0.59.0"],
    [WindowsEnv.UCRT64]: [LATEST],
  },
} as const satisfies Record<
  Arch,
  Record<WindowsEnv, readonly string[] | undefined>
>;

export async function installWin32(target: Target): Promise<string> {
  switch (target.windowsEnv) {
    case WindowsEnv.Native:
      return await installConda(target);
    case WindowsEnv.UCRT64:
      return await installMSYS2();
  }
}

// Installs lfortran via Miniforge/conda-forge. This is the only install path
// on Windows for both x64 and ARM64.
//
// Conda's directory layout on Windows differs from Linux/macOS:
//   lfortran.exe lives in <prefix>\ (the prefix root itself), not bin\.
//   Scripts\ holds Python entry-point wrappers; Library\bin\ holds DLLs.
//   All three need to be on PATH for the toolchain to work correctly.
async function installConda(target: Target): Promise<string> {
  const version = resolveWindowsVersion(target, SUPPORTED_VERSIONS);

  core.info(
    `Installing LFortran ${version} on Windows (${target.arch}) via conda-forge...`,
  );

  const condaPrefix = path.join(os.tmpdir(), "lfortran-conda");
  const miniforgeInstaller = path.join(os.tmpdir(), "miniforge.exe");

  const arch = target.arch === Arch.ARM64 ? "arm64" : "x86_64";
  const miniforgeUrl = `https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Windows-${arch}.exe`;

  core.info(`Downloading Miniforge from ${miniforgeUrl}...`);
  await exec.exec("curl", ["-fsSL", "-o", miniforgeInstaller, miniforgeUrl]);

  // The Miniforge Windows installer is NSIS-based. /S = silent, /D= sets the
  // install prefix and must be the last argument with no quotes around the path.
  core.info(`Installing Miniforge to ${condaPrefix}...`);
  await exec.exec(miniforgeInstaller, ["/S", `/D=${condaPrefix}`]);

  const condaExe = path.join(condaPrefix, "Scripts", "conda.exe");

  await exec.exec(`"${condaExe}"`, [
    "config",
    "--set",
    "channel_priority",
    "strict",
  ]);

  core.info(`Installing lfortran==${version} from conda-forge...`);
  await exec.exec(`"${condaExe}"`, [
    "install",
    "-y",
    "-c",
    "conda-forge",
    `lfortran==${version}`,
  ]);

  // On Windows, conda installs executables into the prefix root, not bin\.
  const lfortranExe = path.join(condaPrefix, "lfortran.exe");

  if (!fs.existsSync(lfortranExe)) {
    throw new Error(`lfortran.exe not found at expected path: ${lfortranExe}`);
  }

  core.info(`Found lfortran binary at: ${lfortranExe}`);

  core.addPath(condaPrefix);
  core.addPath(path.join(condaPrefix, "Scripts"));
  core.addPath(path.join(condaPrefix, "Library", "bin"));

  core.exportVariable("FC", lfortranExe);
  core.exportVariable("FORTRAN_COMPILER", "lfortran");
  core.exportVariable("FORTRAN_COMPILER_VERSION", version);

  const resolvedVersion = await resolveInstalledVersion(lfortranExe);
  core.info(
    `LFortran ${resolvedVersion} installed successfully on Windows (conda).`,
  );
  return resolvedVersion;
}

// Installs lfortran via MSYS2/UCRT64 (x64 only, rolling release).
// The binary lives in C:\msys64\ucrt64\bin\lfortran.exe.
async function installMSYS2(): Promise<string> {
  core.info(
    `Installing LFortran on Windows (MSYS2/UCRT64, rolling release)...`,
  );

  await setupMSYS2(WindowsEnv.UCRT64, ["lfortran"]);

  const msysBin = path.join("C:\\msys64", WindowsEnv.UCRT64, "bin");
  const lfortranExe = path.join(msysBin, "lfortran.exe");

  core.addPath(msysBin);

  core.exportVariable("FC", lfortranExe);
  core.exportVariable("FORTRAN_COMPILER", "lfortran");
  // MSYS2 rolling release has no meaningful version to export; use LATEST.
  core.exportVariable("FORTRAN_COMPILER_VERSION", LATEST);
  core.exportVariable("WINDOWS_ENV", WindowsEnv.UCRT64);

  const resolvedVersion = await resolveInstalledVersion(lfortranExe);
  core.info(
    `LFortran ${resolvedVersion} installed successfully on Windows (MSYS2/UCRT64).`,
  );
  return resolvedVersion;
}

async function resolveInstalledVersion(binaryPath: string): Promise<string> {
  let output = "";
  await exec.exec(`"${binaryPath}"`, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
