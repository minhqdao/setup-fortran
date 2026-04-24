import { OS, type Target } from "../../types";
import { installDebian } from "./debian";
import { installDarwin } from "./darwin";
import { installWin32 } from "./win32";

export async function installIFort(target: Target): Promise<string> {
  switch (target.os) {
    case OS.Linux:
      return await installDebian(target);
    case OS.MacOS:
      return await installDarwin(target);
    case OS.Windows:
      return await installWin32(target);
    default:
      throw new Error(`Unsupported OS: ${target.os as string}`);
  }
}
