import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import { installDebian } from "../../../src/installers/nvfortran/debian";
import {
  Arch,
  Compiler,
  OS,
  Msystem,
  type Inputs,
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
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseInputs: Inputs = {
    compiler: Compiler.NVFortran,
    version: "24.1",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
  cleanupDisk: false,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCache.restoreCache.mockResolvedValue(undefined);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "nvfortran" && args?.[0] === "--version") {
        options?.listeners?.stdout?.(Buffer.from("nvfortran 24.1-0"));
      }
      return 0;
    });
    (exec.getExecOutput as jest.Mock).mockResolvedValue({
      stdout: "install ok installed install ok installed",
      exitCode: 0,
    });
  });

  it("installs legacy ncurses via direct download when needed", async () => {
    // Version <= 24.3 triggers ncurses check
    const inputs = { ...baseInputs, version: "24.3" };
    
    // Simulate ncurses not installed
    (exec.getExecOutput as jest.Mock).mockResolvedValue({
      stdout: "",
      exitCode: 0,
    });

    // Simulate directory listing with valid .deb entries
    const dirListing =
      '<a href="libtinfo5_6.3-2ubuntu0.1_amd64.deb">libtinfo5_6.3-2ubuntu0.1_amd64.deb</a>\n' +
      '<a href="libncursesw5_6.3-2ubuntu0.1_amd64.deb">libncursesw5_6.3-2ubuntu0.1_amd64.deb</a>\n';
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "nvfortran" && args?.[0] === "--version") {
        options?.listeners?.stdout?.(Buffer.from("nvfortran 24.1-0"));
      }
      if (commandLine === "curl" && args?.some(a => typeof a === "string" && a.includes("pool/universe/n/ncurses/"))) {
        options?.listeners?.stdout?.(Buffer.from(dirListing));
      }
      return 0;
    });

    await installDebian(inputs);

    // Should download the directory listing
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining(["-4", "https://archive.ubuntu.com/ubuntu/pool/universe/n/ncurses/"]),
      expect.anything(),
    );
    // Should download each .deb
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        expect.stringContaining("libtinfo5_6.3-2ubuntu0.1_amd64.deb"),
      ]),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        expect.stringContaining("libncursesw5_6.3-2ubuntu0.1_amd64.deb"),
      ]),
    );
    // Should install each .deb via dpkg
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      expect.arrayContaining(["dpkg", "-i", expect.stringContaining("libtinfo5")]),
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      expect.arrayContaining(["dpkg", "-i", expect.stringContaining("libncursesw5")]),
    );
  });

  it("skips ncurses install if already present", async () => {
    const inputs = { ...baseInputs, version: "24.3" };
    
    // Already installed
    (exec.getExecOutput as jest.Mock).mockResolvedValue({
      stdout: "install ok installed install ok installed",
      exitCode: 0,
    });

    await installDebian(inputs);

    // Should not fetch directory listing or download any .deb
    expect(mockedExec).not.toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        expect.stringContaining("archive.ubuntu.com"),
        expect.stringContaining("ncurses"),
      ]),
      expect.anything(),
    );
  });

  it("skips ncurses install for newer nvhpc versions", async () => {
    // Version > 24.3
    const inputs = { ...baseInputs, version: "25.1" };
    
    await installDebian(inputs);

    // Should not fetch directory listing or download any .deb
    expect(mockedExec).not.toHaveBeenCalledWith(
      "curl",
      expect.arrayContaining([
        expect.stringContaining("archive.ubuntu.com"),
        expect.stringContaining("ncurses"),
      ]),
      expect.anything(),
    );
  });

  it("exports compiler variables and returns the installation result", async () => {
    const result = await installDebian(baseInputs);

    expect(result).toEqual({
      version: "nvfortran 24.1-0",
      fc: "nvfortran",
      cc: "nvc",
      cxx: "nvc++",
    });
  });
});
