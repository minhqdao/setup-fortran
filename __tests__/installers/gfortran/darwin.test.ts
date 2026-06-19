import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { installDarwin } from "../../../src/installers/gfortran/darwin";
import {
  Arch,
  Compiler,
  OS,
  Msystem,
  type Target,
} from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");

describe("installDarwin (gfortran)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseTarget: Target = {
    compiler: Compiler.GFortran,
    version: "14",
    os: OS.MacOS,
    osVersion: "13",
    arch: Arch.X64,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "gfortran" && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("GNU Fortran (Homebrew GCC 14.1.0) 14.1.0"));
        }
      }
      if (commandLine === "brew" && args?.[0] === "list") {
        return 1; // Not installed
      }
      if (commandLine === "brew" && args?.[0] === "--prefix") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("/usr/local"));
        }
      }
      if (commandLine === "xcrun" && args?.[0] === "--show-sdk-path") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("/path/to/SDK"));
        }
      }
      return 0;
    });
  });

  it("installs gcc via Homebrew if missing", async () => {
    await installDarwin(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("brew", ["install", "gcc@14"]);
    expect(mockedExec).toHaveBeenCalledWith("ln", [
      "-sf",
      expect.stringContaining("gfortran-14"),
      expect.stringContaining("gfortran"),
    ]);
  });

  it("skips install if already present", async () => {
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "brew" && args?.[0] === "list") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("14.1.0"));
        }
        return 0;
      }
      if (commandLine === "brew" && args?.[0] === "--prefix") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("/usr/local"));
        }
      }
      return 0;
    });

    await installDarwin(baseTarget);
    expect(mockedExec).not.toHaveBeenCalledWith("brew", ["install", "gcc@14"]);
  });

  it("exports environment variables and SDKROOT", async () => {
    await installDarwin(baseTarget);

    expect(mockedExportVariable).toHaveBeenCalledWith("FC", expect.stringContaining("gfortran-14"));
    expect(mockedExportVariable).toHaveBeenCalledWith("F77", expect.stringContaining("gfortran-14"));
    expect(mockedExportVariable).toHaveBeenCalledWith("F90", expect.stringContaining("gfortran-14"));
    expect(mockedExportVariable).toHaveBeenCalledWith("CC", expect.stringContaining("gcc-14"));
    expect(mockedExportVariable).toHaveBeenCalledWith("CXX", expect.stringContaining("g++-14"));
    expect(mockedExportVariable).toHaveBeenCalledWith("FPM_FC", expect.stringContaining("gfortran-14"));
    expect(mockedExportVariable).toHaveBeenCalledWith("FPM_CC", expect.stringContaining("gcc-14"));
    expect(mockedExportVariable).toHaveBeenCalledWith("FPM_CXX", expect.stringContaining("g++-14"));
    expect(mockedExportVariable).toHaveBeenCalledWith("SDKROOT", "/path/to/SDK");
  });

  it("resolves and returns the installed version", async () => {
    const version = await installDarwin(baseTarget);
    expect(version).toContain("14.1.0");
  });
});
