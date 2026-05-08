import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as fs from "fs";
import { installDebian } from "../../../src/installers/nvfortran/debian";
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
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
}));

describe("installDebian (NVFortran)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedGetExecOutput = exec.getExecOutput as jest.MockedFunction<
    typeof exec.getExecOutput
  >;
  const mockedRestoreCache = cache.restoreCache as jest.MockedFunction<
    typeof cache.restoreCache
  >;
  const mockedSaveCache = cache.saveCache as jest.MockedFunction<
    typeof cache.saveCache
  >;

  const baseTarget: Target = {
    compiler: Compiler.NVFortran,
    version: "24.1",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    mockedExec.mockResolvedValue(0);
    mockedGetExecOutput.mockResolvedValue({
      exitCode: 0,
      stdout: "install ok installed\ninstall ok installed",
      stderr: "",
    });
    mockedRestoreCache.mockResolvedValue(undefined);
  });

  it("installs fresh when cache is missing", async () => {
    await installDebian(baseTarget);

    expect(mockedRestoreCache).toHaveBeenCalled();
    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "update",
      "-y",
      "-o",
      "Acquire::http::Timeout=60",
      "-o",
      "Acquire::Retries=3",
    ]);
    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      "nvhpc-24-1",
    ]);
    expect(mockedSaveCache).toHaveBeenCalled();
  });

  it("skips apt install when cache is hit", async () => {
    mockedRestoreCache.mockResolvedValue("hit");
    await installDebian(baseTarget);

    expect(mockedRestoreCache).toHaveBeenCalled();
    expect(mockedExec).not.toHaveBeenCalledWith("sudo", [
      "apt-get",
      "update",
      "-y",
    ]);
    expect(mockedExec).not.toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      "-y",
      expect.any(String),
      expect.any(String),
      "nvhpc-24-1",
    ]);
    expect(mockedSaveCache).not.toHaveBeenCalled();
  });

  it("installs legacy ncurses on older versions if missing", async () => {
    const target = { ...baseTarget, version: "24.3" };
    mockedGetExecOutput.mockResolvedValue({
      exitCode: 0,
      stdout: "not installed",
      stderr: "",
    });

    await installDebian(target);

    expect(mockedExec).toHaveBeenCalledWith("curl", expect.arrayContaining(["-fsSL", "-o"]));
    expect(mockedExec).toHaveBeenCalledWith("sudo", ["dpkg", "-i", expect.stringContaining("libtinfo5")]);
    expect(mockedExec).toHaveBeenCalledWith("sudo", ["dpkg", "-i", expect.stringContaining("libncursesw5")]);
  });

  it("exports environment variables", async () => {
    await installDebian(baseTarget);

    expect(core.addPath).toHaveBeenCalledWith(
      expect.stringContaining("/opt/nvidia/hpc_sdk/Linux_x86_64/24.1/compilers/bin"),
    );
    expect(core.exportVariable).toHaveBeenCalledWith("FC", "nvfortran");
    expect(core.exportVariable).toHaveBeenCalledWith("CC", "nvc");
    expect(core.exportVariable).toHaveBeenCalledWith("CXX", "nvc++");
    expect(core.exportVariable).toHaveBeenCalledWith(
      "LD_LIBRARY_PATH",
      expect.stringContaining("/opt/nvidia/hpc_sdk/Linux_x86_64/24.1/compilers/lib"),
    );
  });
});
