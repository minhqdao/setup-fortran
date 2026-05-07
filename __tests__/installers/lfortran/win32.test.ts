import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import { installWin32 } from "../../../src/installers/lfortran/win32";
import { setupMSYS2 } from "../../../src/setup_msys2";
import {
  Arch,
  Compiler,
  OS,
  Msystem,
  type Target,
} from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("../../../src/setup_msys2");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  renameSync: jest.fn(),
  copyFileSync: jest.fn(),
}));

describe("installWin32 (LFortran)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedSetupMSYS2 = setupMSYS2 as jest.MockedFunction<typeof setupMSYS2>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseTarget: Target = {
    compiler: Compiler.LFortran,
    version: "0.63.0",
    os: OS.Windows,
    osVersion: "2022",
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

  describe("Native (Conda)", () => {
    it("downloads and installs Miniforge", async () => {
      await installWin32(baseTarget);

      expect(mockedExec).toHaveBeenCalledWith("curl", [
        "-fsSL",
        "-o",
        expect.stringContaining("miniforge-install.exe"),
        expect.stringContaining("Miniforge3-Windows-x86_64.exe"),
      ]);
      expect(mockedExec).toHaveBeenCalledWith(
        expect.stringContaining("miniforge-install.exe"),
        ["/S", "/D=C:\\lfortran-conda"],
      );
    });

    it("installs lfortran via conda", async () => {
      await installWin32(baseTarget);

      expect(mockedExec).toHaveBeenCalledWith(
        expect.stringContaining("conda.exe"),
        expect.arrayContaining(["create", "-y", "-n", "lfortran", "lfortran==0.63.0"]),
      );
    });

    it("exports environment variables and sets linker", async () => {
      await installWin32(baseTarget);

      expect(core.addPath).toHaveBeenCalledWith(expect.stringContaining("lfortran"));
      expect(mockedExportVariable).toHaveBeenCalledWith("FC", expect.stringContaining("lfortran.exe"));
      expect(mockedExportVariable).toHaveBeenCalledWith("CC", expect.stringContaining("clang.exe"));
      expect(mockedExportVariable).toHaveBeenCalledWith("CXX", expect.stringContaining("clang++.exe"));
      expect(mockedExportVariable).toHaveBeenCalledWith("FPM_FC", expect.stringContaining("lfortran.exe"));
      expect(mockedExportVariable).toHaveBeenCalledWith("FPM_CC", expect.stringContaining("clang.exe"));
      expect(mockedExportVariable).toHaveBeenCalledWith("FPM_CXX", expect.stringContaining("clang++.exe"));
      expect(mockedExportVariable).toHaveBeenCalledWith("LFORTRAN_LINKER", expect.stringContaining("link.exe"));
    });
  });

  describe("MSYS2", () => {
    it("calls setupMSYS2 and exports variables", async () => {
      const target = { ...baseTarget, msystem: Msystem.UCRT64 };
      await installWin32(target);

      expect(mockedSetupMSYS2).toHaveBeenCalledWith(Msystem.UCRT64, ["lfortran"]);
      expect(mockedExportVariable).toHaveBeenCalledWith("FC", expect.stringContaining("lfortran.exe"));
      expect(mockedExportVariable).toHaveBeenCalledWith("CC", expect.stringContaining("clang.exe"));
      expect(mockedExportVariable).toHaveBeenCalledWith("CXX", expect.stringContaining("clang++.exe"));
      expect(mockedExportVariable).toHaveBeenCalledWith("FPM_FC", expect.stringContaining("lfortran.exe"));
      expect(mockedExportVariable).toHaveBeenCalledWith("FPM_CC", expect.stringContaining("clang.exe"));
      expect(mockedExportVariable).toHaveBeenCalledWith("FPM_CXX", expect.stringContaining("clang++.exe"));
    });
  });
});
