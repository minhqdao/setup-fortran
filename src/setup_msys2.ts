import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import { WindowsEnv } from "./types";

const MSYS2_ROOT = "C:\\msys64";

const PKG_PREFIX: Record<WindowsEnv, string | undefined> = {
  [WindowsEnv.UCRT64]: "mingw-w64-ucrt-x86_64",
  [WindowsEnv.Clang64]: "mingw-w64-clang-x86_64",
  [WindowsEnv.Native]: undefined,
};

export async function setupMSYS2(
  windowsEnv: WindowsEnv,
  packages: string[],
): Promise<void> {
  if (packages.length === 0) return;

  const pkgList = packages
    .map((pkg) => msys2PkgName(windowsEnv, pkg))
    .join(" ");
  core.info(`Installing MSYS2 packages (${windowsEnv}): ${pkgList}`);

  await exec.exec("C:\\msys64\\usr\\bin\\bash.exe", [
    "-lc",
    `pacman -S --noconfirm --needed ${pkgList}`,
  ]);

  const msysRoot = path.join(MSYS2_ROOT, windowsEnv);
  const msysBin = path.join(msysRoot, "bin");
  const msysLib = path.join(msysRoot, "lib");

  core.addPath(msysBin);
  core.exportVariable("MSYSTEM", windowsEnv.toUpperCase());
  core.exportVariable("MSYS2_PATH_TYPE", "inherit");
  core.exportVariable("PKG_CONFIG_PATH", path.join(msysLib, "pkgconfig"));
}

export function msys2PkgName(windowsEnv: WindowsEnv, pkg: string): string {
  const prefix = PKG_PREFIX[windowsEnv];
  if (!prefix) {
    throw new Error(
      `No MSYS2 package prefix known for environment: ${windowsEnv}`,
    );
  }
  return `${prefix}-${pkg}`;
}
