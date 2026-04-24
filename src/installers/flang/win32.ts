import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import { Arch, LATEST, WindowsEnv, type Target } from "../../types";
import { resolveWindowsVersion } from "../../resolve_version";

const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [WindowsEnv.Native]: undefined,
    [WindowsEnv.UCRT64]: [LATEST],
  },
  [Arch.ARM64]: {
    [WindowsEnv.Native]: undefined,
    [WindowsEnv.UCRT64]: undefined,
  },
} as const satisfies Record<
  Arch,
  Record<WindowsEnv, readonly string[] | undefined>
>;

export async function installWin32(target: Target): Promise<string> {
  resolveWindowsVersion(target, SUPPORTED_VERSIONS);

  switch (target.windowsEnv) {
    case WindowsEnv.Native:
      throw new Error(
        "Flang is not supported on Windows native environment yet.",
      );
    case WindowsEnv.UCRT64:
      return await installMSYS2(target);
  }
}

async function installMSYS2(target: Target): Promise<string> {
  const pkgName = "mingw-w64-ucrt-x86_64-flang";
  core.info(`Installing ${pkgName} via MSYS2 pacman (${target.windowsEnv})...`);

  await exec.exec("C:\\msys64\\usr\\bin\\bash.exe", [
    "-lc",
    `pacman -S --noconfirm --needed ${pkgName}`,
  ]);

  const msysBin = path.join("C:", "msys64", target.windowsEnv, "bin");
  core.addPath(msysBin);

  core.info(`Setting FC, F77, and F90 environment variables...`);
  const flangPath = path.join(msysBin, "flang.exe");
  core.exportVariable("FC", flangPath);
  core.exportVariable("F77", flangPath);
  core.exportVariable("F90", flangPath);

  return await resolveInstalledVersion();
}

async function resolveInstalledVersion(): Promise<string> {
  let stdout = "";
  const tool = "flang";

  try {
    await exec.exec(tool, ["--version"], {
      silent: true,
      listeners: { stdout: (data) => (stdout += data.toString()) },
    });
  } catch {
    // try flang-new
    try {
      await exec.exec("flang-new", ["--version"], {
        silent: true,
        listeners: { stdout: (data) => (stdout += data.toString()) },
      });
    } catch (err2) {
      throw new Error(`Failed to verify ${tool} installation`, { cause: err2 });
    }
  }

  return stdout.trim();
}
