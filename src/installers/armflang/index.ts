import { OS, type InstallationResult, type Inputs } from "../../types";
import { installDebian } from "./debian";

export async function installArmFlang(
  inputs: Inputs,
): Promise<InstallationResult> {
  if (inputs.os !== OS.Linux) {
    throw new Error(
      `ArmFlang is only supported on Linux ARM64 (got: ${inputs.os} ${inputs.arch})`,
    );
  }
  return await installDebian(inputs);
}
