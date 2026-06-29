import { type InstallationResult, OS, type Inputs } from "../../types";
import { installDebian } from "./debian";
import { installWin32 } from "./win32";

export async function installIFX(inputs: Inputs): Promise<InstallationResult> {
  switch (inputs.os) {
    case OS.Linux:
      return await installDebian(inputs);
    case OS.MacOS:
      throw new Error(`IFX is not supported on macOS`);
    case OS.Windows:
      return await installWin32(inputs);
  }
}
