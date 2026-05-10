import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import { installDebian } from "../../../src/installers/flang/debian";
import {
  Arch,
  Compiler,
  OS,
  Msystem,
  type Target,
} from "../../../src/types";

jest.mock("@actions/core", () => ({
  info: jest.fn(),
  addPath: jest.fn(),
  exportVariable: jest.fn((name, value) => {
    process.env[name] = value;
  }),
}));
jest.mock("@actions/exec");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
}));

describe("installDebian (Flang)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseTarget: Target = {
    compiler: Compiler.Flang,
    version: "18",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
    msystem: Msystem.Native,
  };

  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    mockedFs.existsSync.mockReturnValue(true);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (
        (commandLine.startsWith("flang-new") ||
          commandLine.startsWith("flang")) &&
        args?.[0] === "--version"
      ) {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("flang version 18.1.0"));
        }
      }
      return 0;
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("calls llvm.sh with the correct version", async () => {
    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("bash", [
      "-c",
      "curl -fsSL --retry 3 --retry-delay 15 https://apt.llvm.org/llvm.sh | sudo bash -s -- 18",
    ]);
  });

  it("installs the correct flang package", async () => {
    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      "-y",
      "flang-18",
      "libomp-18-dev",
    ]);
  });

  it("configures update-alternatives for flang-new (15 <= major < 20)", async () => {
    const target = { ...baseTarget, version: "17" };
    await installDebian(target);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      "/usr/lib/llvm-17/bin/flang-new",
      "100",
    ]);
  });

  it("configures update-alternatives for flang (major >= 20)", async () => {
    const target = { ...baseTarget, version: "20" };
    await installDebian(target);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      "/usr/lib/llvm-20/bin/flang",
      "100",
    ]);
  });

  it("exports environment variables and adds to PATH", async () => {
    await installDebian(baseTarget);

    expect(core.addPath).toHaveBeenCalledWith("/usr/lib/llvm-18/bin");
    expect(mockedExportVariable).toHaveBeenCalledWith("FC", "flang-new-18");
    expect(mockedExportVariable).toHaveBeenCalledWith("CC", "clang-18");
    expect(mockedExportVariable).toHaveBeenCalledWith("CXX", "clang++-18");
    expect(mockedExportVariable).toHaveBeenCalledWith(
      "LIBRARY_PATH",
      "/usr/lib/llvm-18/lib",
    );
  });

  it("exports flang-20 for FC when version is 20", async () => {
    const target = { ...baseTarget, version: "20" };
    await installDebian(target);

    expect(mockedExportVariable).toHaveBeenCalledWith("FC", "flang-20");
    expect(mockedExportVariable).toHaveBeenCalledWith("FPM_FC", "flang-20");
    expect(mockedExportVariable).toHaveBeenCalledWith("FPM_CC", "clang-20");
    expect(mockedExportVariable).toHaveBeenCalledWith("FPM_CXX", "clang++-20");
  });

  it("resolves and returns the installed version", async () => {
    const version = await installDebian(baseTarget);
    expect(version).toBe("flang version 18.1.0");
  });

  it("falls back to versioned symlink if primary binary is missing", async () => {
    mockedFs.existsSync.mockImplementation((path) => {
      if (path === "/usr/lib/llvm-18/bin/flang-new") return false;
      if (path === "/usr/bin/flang-new-18") return true;
      return true;
    });

    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      "/usr/bin/flang-new-18",
      "100",
    ]);
  });

  it("skips update-alternatives if binary is already /usr/bin/flang", async () => {
    mockedFs.existsSync.mockImplementation((path) => {
      if (path === "/usr/lib/llvm-18/bin/flang-new") return false;
      if (path === "/usr/bin/flang-new-18") return false;
      if (path === "/usr/bin/flang-new-18") return false;
      if (path === "/usr/bin/flang") return true;
      return true;
    });

    await installDebian(baseTarget);

    expect(mockedExec).not.toHaveBeenCalledWith("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      "/usr/bin/flang",
      "100",
    ]);
  });

  it("throws error if no flang binary is found", async () => {
    mockedFs.existsSync.mockReturnValue(false);

    await expect(installDebian(baseTarget)).rejects.toThrow(
      /Flang binary not found/,
    );
  });
});
