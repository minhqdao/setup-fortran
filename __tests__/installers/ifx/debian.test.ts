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

describe("IFX installDebian", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;

  const baseTarget: Target = {
    compiler: Compiler.IFX,
    version: "2025.3",
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
          options.listeners.stdout(Buffer.from("ifx (IFX) 2025.3.0"));
        }
      }
      return 0;
    });
  });

  it("installs correct package version", async () => {
    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      "intel-oneapi-compiler-fortran-2025.3",
    ]);
  });

  it("sets FC, CC, CXX environment variables", async () => {
    await installDebian(baseTarget);

    expect(core.exportVariable).toHaveBeenCalledWith("FC", "ifx");
    expect(core.exportVariable).toHaveBeenCalledWith("CC", "icx");
    expect(core.exportVariable).toHaveBeenCalledWith("CXX", "icpx");
  });

  it("throws error for unsupported architecture", async () => {
    const target = { ...baseTarget, arch: Arch.ARM64 };
    await expect(installDebian(target)).rejects.toThrow(
      "No supported versions found for ifx on linux (arm64).",
    );
  });
});
