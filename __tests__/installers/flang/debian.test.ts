import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { installDebian } from "../../../src/installers/flang/debian";
import {
  Arch,
  Compiler,
  OS,
  WindowsEnv,
  type Target,
} from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");

describe("installDebian (Flang)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseTarget: Target = {
    compiler: Compiler.Flang,
    version: "18",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
    windowsEnv: WindowsEnv.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (
        (commandLine === "flang-new" || commandLine === "flang") &&
        args?.[0] === "--version"
      ) {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("flang version 18.1.0"));
        }
      }
      return 0;
    });
  });

  it("calls llvm.sh with the correct version", async () => {
    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("bash", [
      "-c",
      "curl -fsSL https://apt.llvm.org/llvm.sh | sudo bash -s -- 18",
    ]);
  });

  it("installs the correct flang package", async () => {
    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      "-y",
      "flang-18",
    ]);
  });

  it("configures update-alternatives for flang-new (>= 17)", async () => {
    const target = { ...baseTarget, version: "17" };
    await installDebian(target);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      "/usr/bin/flang-new-17",
      "100",
    ]);
  });

  it("configures update-alternatives for flang (<= 16)", async () => {
    const target = { ...baseTarget, version: "16" };
    await installDebian(target);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      "/usr/bin/flang-16",
      "100",
    ]);
  });

  it("exports environment variables", async () => {
    await installDebian(baseTarget);

    expect(mockedExportVariable).toHaveBeenCalledWith("FC", "flang");
    expect(mockedExportVariable).toHaveBeenCalledWith("CC", "clang-18");
    expect(mockedExportVariable).toHaveBeenCalledWith("CXX", "clang++-18");
  });

  it("resolves and returns the installed version", async () => {
    const version = await installDebian(baseTarget);
    expect(version).toBe("flang version 18.1.0");
  });
});
