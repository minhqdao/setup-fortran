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

describe("installDebian (flang)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;

  const baseTarget: Target = {
    compiler: Compiler.Flang,
    version: "19",
    os: OS.Linux,
    osVersion: "24.04",
    arch: Arch.X64,
    windowsEnv: WindowsEnv.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "flang" && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(
            Buffer.from("flang version 19.1.0"),
          );
        }
      }
      return 0;
    });
  });

  it("downloads llvm.sh and installs flang", async () => {
    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("wget", ["-O", "llvm.sh", "https://apt.llvm.org/llvm.sh"]);
    expect(mockedExec).toHaveBeenCalledWith("chmod", ["+x", "llvm.sh"]);
    expect(mockedExec).toHaveBeenCalledWith("sudo", ["./llvm.sh", "19"]);
    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      "-y",
      "flang-19",
    ]);
    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      "/usr/bin/flang-19",
      "100",
    ]);
  });
});
