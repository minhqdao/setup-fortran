import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as fs from "fs";
import { Arch, LATEST, Msystem, type Target } from "../../types";
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
    [Msystem.Native]: [
      "0.63.0",
      "0.62.0",
      "0.61.0",
      "0.60.0",
      "0.59.0",
      "0.58.0",
      "0.57.0",
    ],
    [Msystem.UCRT64]: [LATEST],
    [Msystem.Clang64]: [LATEST],
  },
  [Arch.ARM64]: {
    [Msystem.Native]: undefined,
    [Msystem.UCRT64]: undefined,
    [Msystem.Clang64]: undefined,
  },
} as const satisfies Record<
  Arch,
  Record<Msystem, readonly string[] | undefined>
>;

export async function installWin32(target: Target): Promise<string> {
  switch (target.msystem) {
    case Msystem.Native:
      return await installConda(target);
    case Msystem.UCRT64:
    case Msystem.Clang64:
      return await installMSYS2(target);
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

  const gitLink = "C:\\Program Files\\Git\\usr\\bin\\link.exe";
  if (fs.existsSync(gitLink)) {
    core.info("Moving conflicting Git link.exe to link.exe.bak...");
    try {
      fs.renameSync(gitLink, `${gitLink}.bak`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      core.warning(`Could not move Git link.exe: ${message}`);
    }
  }

  core.info(
    `Installing LFortran ${version} on Windows (${target.arch}) via conda-forge...`,
  );

  const condaPrefix = "C:\\lfortran-conda";
  const miniforgeInstaller = "C:\\miniforge-install.exe";

  const arch = target.arch === Arch.ARM64 ? "arm64" : "x86_64";
  const miniforgeUrl = `https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Windows-${arch}.exe`;

  core.info(`Downloading Miniforge from ${miniforgeUrl}...`);
  await exec.exec("curl", ["-fsSL", "-o", miniforgeInstaller, miniforgeUrl]);

  // The Miniforge Windows installer is NSIS-based. /S = silent, /D= sets the
  // install prefix and must be the last argument with no quotes around the path.
  core.info(`Installing Miniforge to ${condaPrefix}...`);
  await exec.exec(miniforgeInstaller, ["/S", `/D=${condaPrefix}`]);

  const condaExe = path.join(condaPrefix, "Scripts", "conda.exe");

  core.info(`Installing lfortran==${version} from conda-forge...`);
  await exec.exec(`"${condaExe}"`, [
    "create",
    "-y",
    "-n",
    "lfortran",
    "-c",
    "conda-forge",
    "--solver=classic",
    `lfortran==${version}`,
    "lld",
  ]);

  const envPrefix = path.join(condaPrefix, "envs", "lfortran");
  const libraryBin = path.join(envPrefix, "Library", "bin");
  const lfortranExe = path.join(libraryBin, "lfortran.exe");

  if (!fs.existsSync(lfortranExe)) {
    throw new Error(`lfortran.exe not found at expected path: ${lfortranExe}`);
  }

  core.addPath(envPrefix);
  core.addPath(path.join(envPrefix, "Scripts"));
  core.addPath(libraryBin);

  const lldLink = path.join(libraryBin, "lld-link.exe");
  const proxyLink = path.join(libraryBin, "link.exe");

  if (fs.existsSync(lldLink)) {
    if (!fs.existsSync(proxyLink)) {
      core.info("Creating link.exe proxy for lld-link.exe...");
      try {
        // We copy instead of symlink to avoid potential permission issues on Windows
        fs.copyFileSync(lldLink, proxyLink);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        core.warning(`Could not create link.exe proxy: ${message}`);
      }
    }
    // Export the proxy as the preferred linker
    core.info(`Setting LFORTRAN_LINKER to ${proxyLink}`);
    core.exportVariable("LFORTRAN_LINKER", proxyLink);
  } else {
    core.warning(
      "lld-link.exe not found; LFortran may fail to link on Windows.",
    );
  }

  core.exportVariable("FC", lfortranExe);
  core.exportVariable("CC", path.join(libraryBin, "clang.exe"));
  core.exportVariable("CXX", path.join(libraryBin, "clang++.exe"));
  core.exportVariable("FPM_FC", lfortranExe);
  core.exportVariable("FPM_CC", path.join(libraryBin, "clang.exe"));
  core.exportVariable("FPM_CXX", path.join(libraryBin, "clang++.exe"));
  core.exportVariable(
    "LFORTRAN_OMP_LIB_DIR",
    path.join(envPrefix, "Library", "lib"),
  );

  const resolvedVersion = await resolveInstalledVersion(lfortranExe);
  core.info(
    `LFortran ${resolvedVersion} installed successfully on Windows (conda).`,
  );
  return resolvedVersion;
}

// Installs lfortran via MSYS2 (rolling release).
// The binary lives in C:\msys64\<msystem>\bin\lfortran.exe.
async function installMSYS2(target: Target): Promise<string> {
  core.info(
    `Installing LFortran on Windows (MSYS2/${target.msystem}, rolling release)...`,
  );

  await setupMSYS2(target.msystem, ["lfortran"]);

  const msysBin = path.join("C:\\msys64", target.msystem, "bin");
  const lfortranExe = path.join(msysBin, "lfortran.exe");

  core.addPath(msysBin);

  core.exportVariable("FC", lfortranExe);
  core.exportVariable("CC", path.join(msysBin, "clang.exe"));
  core.exportVariable("CXX", path.join(msysBin, "clang++.exe"));
  core.exportVariable("FPM_FC", lfortranExe);
  core.exportVariable("FPM_CC", path.join(msysBin, "clang.exe"));
  core.exportVariable("FPM_CXX", path.join(msysBin, "clang++.exe"));
  core.exportVariable(
    "LFORTRAN_OMP_LIB_DIR",
    path.join("C:\\msys64", target.msystem, "lib"),
  );
  core.exportVariable("WINDOWS_ENV", target.msystem);

  const resolvedVersion = await resolveInstalledVersion(lfortranExe);
  core.info(
    `LFortran ${resolvedVersion} installed successfully on Windows (MSYS2/${target.msystem}).`,
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
