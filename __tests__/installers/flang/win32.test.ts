import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import * as fs from "fs";
import { installWin32 } from "../../../src/installers/flang/win32";
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
jest.mock("@actions/tool-cache");
jest.mock("../../../src/setup_msys2");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(),
}));

describe("installWin32 (Flang)", () => {
  beforeAll(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ tag_name: "llvmorg-22.1.0", prerelease: false }],
    } as unknown as Response);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedTc = tc as jest.Mocked<typeof tc>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedSetupMSYS2 = setupMSYS2 as jest.MockedFunction<typeof setupMSYS2>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseTarget: Target = {
    compiler: Compiler.Flang,
    version: "22",
    os: OS.Windows,
    osVersion: "2022",
    arch: Arch.X64,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readdirSync.mockReturnValue(["14.38.33130" as any]);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine.includes("flang") && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("flang version 22.0.0"));
        }
      }
      if (commandLine.includes("vswhere.exe")) {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("C:\\VS"));
        }
      }
      return 0;
    });
  });

  describe("Native", () => {
    it("downloads and extracts LLVM installer", async () => {
      mockedTc.find.mockReturnValue("");
      mockedTc.downloadTool.mockResolvedValue("C:\\Temp\\llvm.exe");
      mockedTc.cacheDir.mockResolvedValue("C:\\Cache\\flang");

      await installWin32(baseTarget);

      expect(mockedTc.downloadTool).toHaveBeenCalled();
      expect(mockedExec).toHaveBeenCalledWith(
        expect.stringContaining("7z.exe"),
        expect.arrayContaining(["x", "C:\\Temp\\llvm.exe"]),
      );
      expect(mockedTc.cacheDir).toHaveBeenCalled();
    });

    it("sets up MSVC libs and exports variables", async () => {
      mockedTc.find.mockReturnValue("C:\\Cache\\flang");

      await installWin32(baseTarget);

      expect(mockedExportVariable).toHaveBeenCalledWith("LIB", expect.stringContaining("Cache"));
    });
  });

  describe("MSYS2", () => {
    it("calls setupMSYS2 and exports variables", async () => {
      const target = { ...baseTarget, version: "latest", msystem: Msystem.UCRT64 };
      await installWin32(target);

      expect(mockedSetupMSYS2).toHaveBeenCalledWith(Msystem.UCRT64, ["flang"]);
    });
  });
});
