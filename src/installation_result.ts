import * as core from "@actions/core";
import type { InstallationResult } from "./types";

export function exportInstallationVariables(result: InstallationResult): void {
  core.exportVariable("FC", result.fc);
  core.exportVariable("CC", result.cc);
  core.exportVariable("CXX", result.cxx);
  core.exportVariable("FPM_FC", result.fc);
  core.exportVariable("FPM_CC", result.cc);
  core.exportVariable("FPM_CXX", result.cxx);
  core.exportVariable("F77", result.fc);
  core.exportVariable("F90", result.fc);
}

export function setInstallationOutputs(result: InstallationResult): void {
  core.setOutput("version", result.version);
  core.setOutput("fc", result.fc);
  core.setOutput("cc", result.cc);
  core.setOutput("cxx", result.cxx);
}
