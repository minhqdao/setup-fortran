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
    expect(core.setOutput).toHaveBeenCalledWith("f77", "fortran");
    expect(core.setOutput).toHaveBeenCalledWith("f90", "fortran");
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
});
