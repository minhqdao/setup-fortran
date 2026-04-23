import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as tc from "@actions/tool-cache";
import { Arch, WindowsEnv, type Target } from "../../types";
import { resolveWindowsVersion } from "../../resolve_version";

const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [WindowsEnv.Native]: ["15", "14", "13", "12", "11"],
    [WindowsEnv.UCRT64]: ["15", "14", "13", "12", "11"],
    [WindowsEnv.Clang64]: ["15", "14", "13", "12", "11"],
    [WindowsEnv.ClangArm64]: undefined,
    [WindowsEnv.MinGW64]: ["15", "14", "13", "12", "11"],
  },
  [Arch.ARM64]: {
    [WindowsEnv.Native]: ["15", "14", "13", "12", "11"],
    [WindowsEnv.UCRT64]: undefined,
    [WindowsEnv.ClangArm64]: undefined,
    [WindowsEnv.MinGW64]: undefined,
    [WindowsEnv.Clang64]: undefined,
  },
} as const satisfies Record<
  Arch,
  Record<WindowsEnv, readonly string[] | undefined>
>;

const WINLIBS_RELEASES: Record<string, string> = {
  "15": "15.2.0-19.1.7-12.0.0-r1",
  "14": "14.2.0-18.1.8-12.0.0-r1",
  "13": "13.2.0-11.0.1-r5",
  "12": "12.3.0-11.0.0-r3",
  "11": "11.4.0-11.0.0-r1",
};

export async function installWin32(target: Target): Promise<string> {
  const version = resolveWindowsVersion(target, SUPPORTED_VERSIONS);

  if (target.windowsEnv === WindowsEnv.Native) {
    return await installNative(target, version);
  }

  return await installMSYS2(target);
}

/**
 * Installs Fortran via MSYS2 (UCRT64, MinGW64)
 * Note: MSYS2 usually only provides the 'latest' version in their main repo.
 */
async function installMSYS2(target: Target): Promise<string> {
  const env = target.windowsEnv;

  // Guard against Flang environments if we are GFortran-only for now
  if (env === WindowsEnv.Clang64 || env === WindowsEnv.ClangArm64) {
    throw new Error(
      `GFortran is not available in the ${env} environment. Please use UCRT64, MinGW64, or Native.`,
    );
  }

  core.info(`Installing GFortran (Latest) on Windows via MSYS2 ${env}...`);

  const archLabel = target.arch === Arch.X64 ? "x86_64" : "aarch64";
  const subEnv = env === WindowsEnv.UCRT64 ? "ucrt" : "x86_64";
  const pkgName = `mingw-w64-${subEnv}-${archLabel}-gcc-fortran`;

  // MSYS2 pacman doesn't easily support 'gcc-fortran@11'
  // It will install the latest available
  await exec.exec("bash", ["-c", `pacman -S --noconfirm --needed ${pkgName}`]);

  const msysBin = path.join("C:", "msys64", env, "bin");
  core.addPath(msysBin);

  return await resolveInstalledVersion();
}

async function installNative(target: Target, version: string): Promise<string> {
  const archPrefix = target.arch === Arch.X64 ? "x86_64" : "i686";
  const releaseStr = WINLIBS_RELEASES[version];

  if (!releaseStr) {
    throw new Error(`Unsupported native version: ${version}`);
  }

  let fileNamePart = releaseStr;
  if (version === "15" || version === "14") {
    fileNamePart = releaseStr.replace("-", "-llvm-");
  }

  // WinLibs format: winlibs-[arch]-posix-seh-gcc-[releaseStr].zip
  // Note: GCC 14/15 include LLVM in the release string, GCC 11-13 do not.
  // The 'releaseStr' provided above already accounts for this.
  const downloadUrl = `https://github.com/brechtsanders/winlibs_mingw/releases/download/${releaseStr}/winlibs-${archPrefix}-posix-seh-gcc-${fileNamePart}.zip`;

  let toolRoot = tc.find("gfortran-native", version, archPrefix);

  if (!toolRoot) {
    core.info(`Downloading GFortran ${version} from WinLibs...`);
    const downloadPath = await tc.downloadTool(downloadUrl);

    // WinLibs usually comes in .zip or .7z. TC handles .zip well.
    const extractPath = await tc.extractZip(downloadPath);

    // Identify the internal folder (mingw64 or mingw32)
    const internalFolder = target.arch === Arch.X64 ? "mingw64" : "mingw32";
    const actualToolDir = path.join(extractPath, internalFolder);

    // Cache the extracted mingwXX folder directly
    toolRoot = await tc.cacheDir(
      actualToolDir,
      "gfortran-native",
      version,
      archPrefix,
    );
  }

  const binPath = path.join(toolRoot, "bin");
  core.addPath(binPath);

  // Set standard Fortran environment variables
  const gfortranPath = path.join(binPath, "gfortran.exe");
  core.exportVariable("FC", gfortranPath);
  core.exportVariable("F77", gfortranPath);
  core.exportVariable("F90", gfortranPath);

  return await resolveInstalledVersion();
}

async function resolveInstalledVersion(): Promise<string> {
  let stdout = "";

  // In Native/WinLibs, it's always gfortran.
  // Flang is usually only in Clang64 environments.
  const tool = "gfortran";

  try {
    await exec.exec(tool, ["-dumpversion"], {
      silent: true,
      listeners: { stdout: (data) => (stdout += data.toString()) },
    });
  } catch (err) {
    throw new Error(`Failed to verify ${tool} installation`, { cause: err });
  }

  const version = stdout.trim();
  if (!/^\d+/.test(version)) {
    throw new Error(`Unexpected version format: ${version}`);
  }
  return version;
}
