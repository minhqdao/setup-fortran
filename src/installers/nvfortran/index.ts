import { OS, type InstallationResult, type Target } from "../../types";
import { installDebian } from "./debian";

export async function installNVFortran(
  target: Target,
): Promise<InstallationResult> {
  if (target.os !== OS.Linux) {
    throw new Error(`NVFortran is only supported on Linux (got: ${target.os})`);
  }
  return await installDebian(target);
}
