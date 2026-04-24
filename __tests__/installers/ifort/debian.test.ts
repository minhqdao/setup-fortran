import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { installDebian } from "../../../src/installers/ifort/debian";
import {
  Arch,
  Compiler,
  OS,
  WindowsEnv,
  type Target,
} from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");

describe("installDebian (ifort)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;

  const baseTarget: Target = {
    compiler: Compiler.IFort,
    version: "2023.2",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
    windowsEnv: WindowsEnv.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "ifort" && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(
            Buffer.from("ifort (IFORT) 2021.10.0 20230609"),
          );
        }
      }
      return 0;
    });
  });

  it("adds Intel repository and installs ifort", async () => {
    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("bash", [
      "-c",
      expect.stringContaining("apt.repos.intel.com"),
    ]);
    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      "intel-oneapi-compiler-fortran-2023.2",
      "intel-oneapi-common-vars",
    ]);
  });

  it("sources setvars.sh and exports variables", async () => {
    mockedExec.mockImplementation(async (commandLine, args, options) => {
        if (commandLine === "bash" && args?.[1]?.includes("setvars.sh")) {
            if (options?.listeners?.stdout) {
                options.listeners.stdout(Buffer.from("PATH=/opt/intel/oneapi/bin\nINTEL_PYTHONHOME=/opt/intel/oneapi/python\n"));
            }
        }
        return 0;
    });

    await installDebian(baseTarget);

    expect(core.exportVariable).toHaveBeenCalledWith("PATH", "/opt/intel/oneapi/bin");
    expect(core.exportVariable).toHaveBeenCalledWith("INTEL_PYTHONHOME", "/opt/intel/oneapi/python");
    expect(core.exportVariable).toHaveBeenCalledWith("FC", "ifort");
  });
});
