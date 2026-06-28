import { type InstallationResult, OS, type Target } from "../../types";
import { installDebian } from "./debian";
import { installWin32 } from "./win32";

export async function installIFX(target: Target): Promise<InstallationResult> {
  switch (target.os) {
    case OS.Linux:
      return await installDebian(target);
    case OS.MacOS:
      throw new Error(`IFX is not supported on macOS`);
    case OS.Windows:
      return await installWin32(target);
  }
}
