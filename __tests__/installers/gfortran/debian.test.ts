import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { installDebian } from "../../../src/installers/gfortran/debian";
import {
  Arch,
  Compiler,
  OS,
  WindowsEnv,
  type Target,
} from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");

describe("installDebian", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;

  const baseTarget: Target = {
    compiler: Compiler.GFortran,
    version: "14",
    os: OS.Linux,
    osVersion: "20.04.6",
    arch: Arch.X64,
    windowsEnv: WindowsEnv.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "gfortran" && args?.[0] === "--version") {
        // Mocking stdout for version resolution
        if (options?.listeners?.stdout) {
          options.listeners.stdout(
            Buffer.from("GNU Fortran (Ubuntu 14.2.0-1ubuntu2~22.04) 14.2.0"),
          );
        }
      }
      return 0;
    });
  });

  // it("adds PPA when version is 15", async () => {
  //   const target = { ...baseTarget, version: "15" };
  //   await installDebian(target);

  //   expect(mockedExec).toHaveBeenCalledWith("sudo", [
  //     "add-apt-repository",
  //     "--yes",
  //     "ppa:ubuntu-toolchain-r/test",
  //   ]);
  // });

  // it("adds PPA when osVersion includes 22", async () => {
  //   const target = { ...baseTarget, osVersion: "Ubuntu 22.04.3 LTS" };
  //   await installDebian(target);

  //   expect(mockedExec).toHaveBeenCalledWith("sudo", [
  //     "add-apt-repository",
  //     "--yes",
  //     "ppa:ubuntu-toolchain-r/test",
  //   ]);
  // });

  // it("does not add PPA when version is not 15 and osVersion does not include 22", async () => {
  //   const target = { ...baseTarget, version: "13", osVersion: "20.04.6" };
  //   await installDebian(target);

  //   expect(mockedExec).not.toHaveBeenCalledWith("sudo", [
  //     "add-apt-repository",
  //     "--yes",
  //     "ppa:ubuntu-toolchain-r/test",
  //   ]);
  // });

  it("always updates apt and installs gfortran", async () => {
    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "update",
      "-y",
    ]);
    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      "-y",
      "gcc-14",
      "gfortran-14",
    ]);
  });
});
