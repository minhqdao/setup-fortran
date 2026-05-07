import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as tc from "@actions/tool-cache";
import * as fs from "fs";
import { installDarwin } from "../../../src/installers/ifort/darwin";
import {
  Arch,
  Compiler,
  OS,
  Msystem,
  type Target,
} from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/cache");
jest.mock("@actions/tool-cache");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe("installDarwin (ifort)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedCache = cache as jest.Mocked<typeof cache>;
  const mockedTc = tc as jest.Mocked<typeof tc>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseTarget: Target = {
    compiler: Compiler.IFort,
    version: "2021.10",
    os: OS.MacOS,
    osVersion: "13",
    arch: Arch.X64,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "ifort" && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(
            Buffer.from("ifort (IFORT) 2021.10.0 20230609"),
          );
        }
      }
      if (commandLine === "bash" && args?.[1]?.includes("setvars.sh")) {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(
            Buffer.from(
              "PATH=/opt/intel/oneapi/compiler/latest/bin\nONEAPI_ROOT=/opt/intel/oneapi",
            ),
          );
        }
      }
      return 0;
    });
  });

  it("restores from cache if available", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");

    await installDarwin(baseTarget);

    expect(mockedCache.restoreCache).toHaveBeenCalled();
    expect(mockedTc.downloadTool).not.toHaveBeenCalled();
  });

  it("downloads and installs if cache is missing", async () => {
    mockedCache.restoreCache.mockResolvedValue(undefined);
    mockedTc.downloadTool.mockResolvedValue("/tmp/ifort.dmg");

    await installDarwin(baseTarget);

    expect(mockedTc.downloadTool).toHaveBeenCalled();
    expect(mockedExec).toHaveBeenCalledWith("hdiutil", [
      "attach",
      "/tmp/ifort.dmg",
      "-mountpoint",
      "/Volumes/Intel_oneAPI_Installer",
      "-quiet",
      "-nobrowse",
    ]);
    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      expect.stringContaining("install.sh"),
      "--silent",
      "--eula",
      "accept",
    ]);
    expect(mockedCache.saveCache).toHaveBeenCalled();
  });

  it("throws error on ARM64", async () => {
    const target = { ...baseTarget, arch: Arch.ARM64 };
    await expect(installDarwin(target)).rejects.toThrow(
      "No supported versions found for ifort on darwin (arm64)",
    );
  });

  it("exports environment variables", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");

    await installDarwin(baseTarget);

    expect(mockedExportVariable).toHaveBeenCalledWith(
      "ONEAPI_ROOT",
      "/opt/intel/oneapi",
    );
    expect(mockedExportVariable).toHaveBeenCalledWith("FC", "ifort");
    expect(mockedExportVariable).toHaveBeenCalledWith("CC", "icc");
    expect(mockedExportVariable).toHaveBeenCalledWith("CXX", "icpc");
    expect(mockedExportVariable).toHaveBeenCalledWith("FPM_FC", "ifort");
    expect(mockedExportVariable).toHaveBeenCalledWith("FPM_CC", "icc");
    expect(mockedExportVariable).toHaveBeenCalledWith("FPM_CXX", "icpc");
  });

  it("resolves and returns the installed version", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");
    const version = await installDarwin(baseTarget);
    expect(version).toBe("ifort (IFORT) 2021.10.0 20230609");
  });
});
