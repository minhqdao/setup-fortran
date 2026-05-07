import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import { installDebian } from "../../../src/installers/lfortran/debian";
import {
  Arch,
  Compiler,
  OS,
  Msystem,
  type Target,
} from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
}));

describe("installDebian (LFortran)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseTarget: Target = {
    compiler: Compiler.LFortran,
    version: "0.63.0",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine.includes("lfortran") && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("LFortran version 0.63.0"));
        }
      }
      return 0;
    });
  });

  it("downloads and installs Miniforge", async () => {
    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("curl", [
      "-fsSL",
      "-o",
      expect.stringContaining("miniforge.sh"),
      expect.stringContaining("Miniforge3-Linux-x86_64.sh"),
    ]);
    expect(mockedExec).toHaveBeenCalledWith("bash", [
      expect.stringContaining("miniforge.sh"),
      "-b",
      "-p",
      expect.stringContaining("lfortran-conda"),
    ]);
  });

  it("installs lfortran via conda", async () => {
    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith(
      expect.stringContaining("conda"),
      ["install", "-y", "-c", "conda-forge", "lfortran==0.63.0"],
    );
  });

  it("throws error on ARM64", async () => {
    const target = { ...baseTarget, arch: Arch.ARM64 };
    await expect(installDebian(target)).rejects.toThrow(
      "LFortran is not available for Linux ARM64 on conda-forge",
    );
  });

  it("exports environment variables", async () => {
    await installDebian(baseTarget);

    expect(core.addPath).toHaveBeenCalledWith(expect.stringContaining("bin"));
    expect(mockedExportVariable).toHaveBeenCalledWith("FC", "lfortran");
    expect(mockedExportVariable).toHaveBeenCalledWith("CC", "clang");
    expect(mockedExportVariable).toHaveBeenCalledWith("CXX", "clang++");
    expect(mockedExportVariable).toHaveBeenCalledWith("FPM_FC", "lfortran");
    expect(mockedExportVariable).toHaveBeenCalledWith("FPM_CC", "clang");
    expect(mockedExportVariable).toHaveBeenCalledWith("FPM_CXX", "clang++");
    expect(mockedExportVariable).toHaveBeenCalledWith(
      "LFORTRAN_OMP_LIB_DIR",
      expect.stringContaining("lib"),
    );
  });

  it("resolves and returns the installed version", async () => {
    const version = await installDebian(baseTarget);
    expect(version).toBe("LFortran version 0.63.0");
  });
});
