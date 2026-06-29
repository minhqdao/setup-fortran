import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { installWin32 } from "../../../src/installers/gfortran/win32";
import { setupMSYS2 } from "../../../src/setup_msys2";
import {
  Arch,
  Compiler,
  OS,
  Msystem,
  type Inputs,
} from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/tool-cache");
jest.mock("../../../src/setup_msys2");

describe("installWin32 (gfortran)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedTc = tc as jest.Mocked<typeof tc>;
  const mockedSetupMSYS2 = setupMSYS2 as jest.MockedFunction<typeof setupMSYS2>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseInputs: Inputs = {
    compiler: Compiler.GFortran,
    version: "14",
    os: OS.Windows,
    osVersion: "2022",
    arch: Arch.X64,
  cleanupDisk: false,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "gfortran" && args?.[0] === "-dumpversion") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("14.1.0"));
        }
      }
      return 0;
    });
  });

  describe("Native", () => {
    it("downloads and extracts GFortran", async () => {
      mockedTc.find.mockReturnValue("");
      mockedTc.downloadTool.mockResolvedValue("C:\\Temp\\gcc.zip");
      mockedTc.extractZip.mockResolvedValue("C:\\Temp\\extracted");
      mockedTc.cacheDir.mockResolvedValue("C:\\Cache\\gfortran");

      await installWin32(baseInputs);

      expect(mockedTc.downloadTool).toHaveBeenCalled();
      expect(mockedTc.extractZip).toHaveBeenCalledWith("C:\\Temp\\gcc.zip");
      expect(mockedTc.cacheDir).toHaveBeenCalled();
      expect(core.addPath).toHaveBeenCalledWith(expect.stringContaining("bin"));
    });

    it("exports environment variables", async () => {
      mockedTc.find.mockReturnValue("C:\\Cache\\gfortran");

      await installWin32(baseInputs);

    });
  });

  describe("MSYS2", () => {
    it("calls setupMSYS2 and exports variables", async () => {
      const inputs = { ...baseInputs, version: "latest", msystem: Msystem.UCRT64 };
      await installWin32(inputs);

      expect(mockedSetupMSYS2).toHaveBeenCalledWith(Msystem.UCRT64, ["gcc-fortran"]);
    });
  });
});
