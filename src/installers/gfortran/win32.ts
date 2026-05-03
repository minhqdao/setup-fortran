import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as tc from "@actions/tool-cache";
import { Arch, LATEST, WindowsEnv, type Target } from "../../types";
import { resolveWindowsVersion } from "../../resolve_version";
import { setupMSYS2 } from "../../setup_msys2";

// Make sure the versions are in descending order. The first one will be
// used as the default if no version was specified by the user.
const GCC_RELEASES = [
  {
    version: "16",
    url: "https://github.com/brechtsanders/winlibs_mingw/releases/download/16.1.0posix-14.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-16.1.0-mingw-w64ucrt-14.0.0-r1.zip",
  },
  {
    version: "15",
    url: "https://github.com/brechtsanders/winlibs_mingw/releases/download/15.2.0posix-14.0.0-ucrt-r7/winlibs-x86_64-posix-seh-gcc-15.2.0-mingw-w64ucrt-14.0.0-r7.zip",
  },
  {
    version: "14",
    url: "https://github.com/brechtsanders/winlibs_mingw/releases/download/14.3.0posix-12.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-14.3.0-mingw-w64ucrt-12.0.0-r1.zip",
  },
  {
    version: "13",
    url: "https://github.com/brechtsanders/winlibs_mingw/releases/download/13.3.0posix-11.0.1-ucrt-r1/winlibs-x86_64-posix-seh-gcc-13.3.0-mingw-w64ucrt-11.0.1-r1.zip",
  },
  {
    version: "12",
    url: "https://github.com/brechtsanders/winlibs_mingw/releases/download/12.4.0posix-12.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-12.4.0-mingw-w64ucrt-12.0.0-r1.zip",
  },
  {
    version: "11",
    url: "https://github.com/brechtsanders/winlibs_mingw/releases/download/11.5.0posix-12.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-11.5.0-mingw-w64ucrt-12.0.0-r1.zip",
  },
] as const;

const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [WindowsEnv.Native]: GCC_RELEASES.map((r) => r.version),
    [WindowsEnv.UCRT64]: [LATEST],
    [WindowsEnv.Clang64]: undefined,
  },
  [Arch.ARM64]: {
    [WindowsEnv.Native]: undefined,
    [WindowsEnv.UCRT64]: undefined,
    [WindowsEnv.Clang64]: undefined,
  },
} as const satisfies Record<
  Arch,
  Record<WindowsEnv, readonly string[] | undefined>
>;

export async function installWin32(target: Target): Promise<string> {
  const version = resolveWindowsVersion(target, SUPPORTED_VERSIONS);

  switch (target.windowsEnv) {
    case WindowsEnv.Native:
      return await installNative(target, version);
    case WindowsEnv.UCRT64:
      return await installMSYS2(target);
    case WindowsEnv.Clang64:
      throw new Error(
        `Clang/LLVM's clang-cl does not include gfortran and is not supported by this installer. ` +
          `Please use the "native" WindowsEnv to install the latest gfortran via conda-forge, or ` +
          `use MSYS2 with WindowsEnv "ucrt64" for a rolling-release version of gfortran.`,
      );
  }
}

async function installNative(target: Target, version: string): Promise<string> {
  const release = GCC_RELEASES.find((r) => r.version === version);
  if (!release) {
    throw new Error(`Unsupported GFortran version: ${version}`);
  }
  const downloadUrl = release.url;

  let toolRoot = tc.find(`gfortran-${target.windowsEnv}`, version, target.arch);

  if (!toolRoot) {
    core.info(`Downloading GFortran ${version} from ${downloadUrl}`);
    const downloadPath = await tc.downloadTool(downloadUrl);

    core.info(`Extracting GFortran ${version} from ${downloadPath}...`);
    const extractPath = await tc.extractZip(downloadPath);

    const actualToolDir = path.join(extractPath, "mingw64");

    core.info(`Caching GFortran ${version} in ${actualToolDir}...`);
    toolRoot = await tc.cacheDir(
      actualToolDir,
      `gfortran-${target.windowsEnv}`,
      version,
      target.arch,
    );
  }

  const binPath = path.join(toolRoot, "bin");
  core.addPath(binPath);

  core.info(`Setting FC, F77, and F90 environment variables...`);
  const gfortranPath = path.join(binPath, "gfortran.exe");
  core.exportVariable("FC", gfortranPath);
  core.exportVariable("F77", gfortranPath);
  core.exportVariable("F90", gfortranPath);

  return await resolveInstalledVersion();
}

async function installMSYS2(target: Target): Promise<string> {
  await setupMSYS2(target.windowsEnv, ["gcc-fortran"]);

  const msysBin = path.join("C:\\msys64", target.windowsEnv, "bin");
  const gfortranPath = path.join(msysBin, "gfortran.exe");

  core.info(`Setting FC, F77, and F90 environment variables...`);
  core.exportVariable("FC", gfortranPath);
  core.exportVariable("F77", gfortranPath);
  core.exportVariable("F90", gfortranPath);

  return await resolveInstalledVersion();
}

async function resolveInstalledVersion(): Promise<string> {
  let stdout = "";
  const tool = "gfortran";

  try {
    await exec.exec(tool, ["-dumpversion"], {
      silent: true,
      listeners: { stdout: (data) => (stdout += data.toString()) },
    });
  } catch (err) {
    throw new Error(`Failed to verify ${tool} installation`, { cause: err });
  }

  return stdout.trim();
}
