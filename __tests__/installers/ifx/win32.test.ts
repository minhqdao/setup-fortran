import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import { installWin32 } from "../../../src/installers/ifx/win32";
import {
  Arch,
  Compiler,
  OS,
  WindowsEnv,
  type Target,
} from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
}));

describe("IFX installWin32", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedFs = fs as jest.Mocked<typeof fs>;

  const baseTarget: Target = {
    compiler: Compiler.IFX,
    version: "latest",
    os: OS.Windows,
    osVersion: "10.0.19041",
    arch: Arch.X64,
    windowsEnv: WindowsEnv.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "ifx" && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("ifx (IFX) 2025.3.0"));
        }
      }
      return 0;
    });
    (mockedFs.existsSync as jest.Mock).mockReturnValue(true);
  });

  it("calls winget via powershell to install", async () => {
    await installWin32(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("powershell", [
      "-Command",
      "winget install --id Intel.FortranCompiler --accept-package-agreements --accept-source-agreements",
    ]);
  });

  it("sets FC, CC, CXX environment variables", async () => {
    await installWin32(baseTarget);

    expect(core.exportVariable).toHaveBeenCalledWith("FC", "ifx");
    expect(core.exportVariable).toHaveBeenCalledWith("CC", "icx");
    expect(core.exportVariable).toHaveBeenCalledWith("CXX", "icpx");
  });

  it("throws error if setvars.bat is missing", async () => {
    (mockedFs.existsSync as jest.Mock).mockReturnValue(false);
    await expect(installWin32(baseTarget)).rejects.toThrow(
      /setvars.bat not found/,
    );
  });
});
