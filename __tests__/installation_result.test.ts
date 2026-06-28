import * as core from "@actions/core";
import {
  exportInstallationVariables,
  setInstallationOutputs,
} from "../src/installation_result";
import type { InstallationResult } from "../src/types";

jest.mock("@actions/core");

describe("installation result helpers", () => {
  const result: InstallationResult = {
    version: "compiler version",
    fc: "fortran",
    cc: "c",
    cxx: "cxx",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sets action outputs from the installation result", () => {
    setInstallationOutputs(result);

    expect(core.setOutput).toHaveBeenCalledWith("version", "compiler version");
    expect(core.setOutput).toHaveBeenCalledWith("fc", "fortran");
    expect(core.setOutput).toHaveBeenCalledWith("cc", "c");
    expect(core.setOutput).toHaveBeenCalledWith("cxx", "cxx");
  });

  it("exports compiler, fpm, and alias variables from the installation result", () => {
    exportInstallationVariables(result);

    expect(core.exportVariable).toHaveBeenCalledWith("FC", "fortran");
    expect(core.exportVariable).toHaveBeenCalledWith("CC", "c");
    expect(core.exportVariable).toHaveBeenCalledWith("CXX", "cxx");
    expect(core.exportVariable).toHaveBeenCalledWith("FPM_FC", "fortran");
    expect(core.exportVariable).toHaveBeenCalledWith("FPM_CC", "c");
    expect(core.exportVariable).toHaveBeenCalledWith("FPM_CXX", "cxx");
    expect(core.exportVariable).toHaveBeenCalledWith("F77", "fortran");
    expect(core.exportVariable).toHaveBeenCalledWith("F90", "fortran");
  });

  it("ensures environment variables and action outputs are in sync", () => {
    setInstallationOutputs(result);
    exportInstallationVariables(result);

    const outputs = (core.setOutput as jest.Mock).mock.calls.reduce(
      (acc: Record<string, string>, [key, val]) => {
        acc[key] = val;
        return acc;
      },
      {},
    );

    const envVars = (core.exportVariable as jest.Mock).mock.calls.reduce(
      (acc: Record<string, string>, [key, val]) => {
        acc[key] = val;
        return acc;
      },
      {},
    );

    expect(envVars["FC"]).toBe(outputs["fc"]);
    expect(envVars["CC"]).toBe(outputs["cc"]);
    expect(envVars["CXX"]).toBe(outputs["cxx"]);

    // Also check aliases
    expect(envVars["FPM_FC"]).toBe(outputs["fc"]);
    expect(envVars["F77"]).toBe(outputs["fc"]);
    expect(envVars["F90"]).toBe(outputs["fc"]);
    expect(envVars["FPM_CC"]).toBe(outputs["cc"]);
    expect(envVars["FPM_CXX"]).toBe(outputs["cxx"]);
  });
});
