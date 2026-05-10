import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
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

describe("installDebian nvfortran", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedGetExecOutput = exec.getExecOutput as jest.MockedFunction<
    typeof exec.getExecOutput
  >;
  const mockedCache = cache as jest.Mocked<typeof cache>;

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
    mockedCache.restoreCache.mockResolvedValue(undefined);
    mockedExec.mockResolvedValue(0);
    (exec.getExecOutput as jest.Mock).mockResolvedValue({
      stdout: "install ok installed install ok installed",
      exitCode: 0,
    });
  });

  it("calls curl with retry for legacy ncurses", async () => {
    // Version <= 24.3 triggers ncurses check
    const target = { ...baseTarget, version: "24.3" };
    
    // Simulate ncurses not installed
    (exec.getExecOutput as jest.Mock).mockResolvedValue({
      stdout: "",
      exitCode: 0,
    });

    await installDebian(target);

    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining(["--retry", "5", "--retry-delay", "10"]),
    );
  });

  it("skips ncurses install if already present", async () => {
    const target = { ...baseTarget, version: "24.3" };
    
    // Already installed
    (exec.getExecOutput as jest.Mock).mockResolvedValue({
      stdout: "install ok installed install ok installed",
      exitCode: 0,
    });

    await installDebian(target);

    expect(mockedExec).not.toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining(["--retry", "5"]),
    );
  });

  it("skips ncurses install for newer nvhpc versions", async () => {
    // Version > 24.3
    const target = { ...baseTarget, version: "25.1" };
    
    await installDebian(target);

    expect(mockedExec).not.toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining(["--retry", "5"]),
    );
  });
});
