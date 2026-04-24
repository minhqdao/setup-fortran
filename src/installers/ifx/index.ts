import { OS, Arch, type Target } from "../../types";
import { installDebian } from "./debian";
import { installWin32 } from "./win32";

export async function installIFX(target: Target): Promise<string> {
  if (target.arch === Arch.ARM64) {
    throw new Error(`IFX is not supported on ARM64 architecture.`);
  }

  switch (target.os) {
    case OS.Linux:
      return await installDebian(target);
    case OS.Windows:
      return await installWin32(target);
    case OS.MacOS:
      throw new Error(`IFX is not supported on macOS (Darwin).`);
    default: {
      const os: string = target.os;
      throw new Error(`Unsupported OS for IFX: ${os}`);
    }
  }
}
