import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { installDebian } from "../../../src/installers/ifx/debian";
import {
  Arch,
  Compiler,
  OS,
  WindowsEnv,
  type Target,
} from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");

describe("installDebian ifx", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;

  const baseTarget: Target = {
    compiler: Compiler.IFX,
    version: "2025.2.1",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
    windowsEnv: WindowsEnv.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "ifx" && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("ifx (IFX) 2025.2.1 20250101"));
        }
      }
      if (commandLine === "bash" && args?.[1]?.includes("setvars.sh")) {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("PATH=/opt/intel/oneapi/compiler/latest/bin\nONEAPI_ROOT=/opt/intel/oneapi"));
        }
      }
      return 0;
    });
  });

  it("installs the correct versioned packages for 2025.2.1", async () => {
    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      "intel-oneapi-compiler-fortran-2025.2",
      "intel-oneapi-compiler-dpcpp-cpp-2025.2",
    ]);
  });

  it("installs the correct versioned packages for 2023.2.0", async () => {
    const target = { ...baseTarget, version: "2023.2.0" };
    await installDebian(target);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      "intel-oneapi-compiler-fortran-2023.2.0",
      "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic-2023.2.0",
    ]);
  });

  it("maps 2-digit version 2025.2 to 2025.2", async () => {
    const target = { ...baseTarget, version: "2025.2" };
    await installDebian(target);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      "intel-oneapi-compiler-fortran-2025.2",
      "intel-oneapi-compiler-dpcpp-cpp-2025.2",
    ]);
  });

  it("adds the Intel repository", async () => {
    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("bash", [
      "-c",
      expect.stringContaining("https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB"),
    ]);
    expect(mockedExec).toHaveBeenCalledWith("bash", [
      "-c",
      expect.stringContaining("https://apt.repos.intel.com/oneapi all main"),
    ]);
  });
});
