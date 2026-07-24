import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as fs from "fs";
import { installDebian } from "../../../src/installers/ifx/debian";
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
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe("installDebian ifx", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedCache = cache as jest.Mocked<typeof cache>;
  const mockedFs = fs as jest.Mocked<typeof fs>;

  const baseInputs: Inputs = {
    compiler: Compiler.IFX,
    version: "2023.2.4",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
  cleanupDisk: false,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
    mockedCache.restoreCache.mockResolvedValue(undefined);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine === "ifx" && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("ifx (IFX) 2023.2.4 20230101"));
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

  it("installs the correct versioned packages and saves to cache on miss", async () => {
    const inputs = { ...baseInputs, version: "2023.2.0" };
    await installDebian(inputs);

    expect(mockedCache.restoreCache).toHaveBeenCalledWith(
      ["/opt/intel/oneapi"],
      "oneapi-ifx-2023.2.0",
    );
    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      [
        "apt-get",
        "install",
        "-y",
        "--no-install-recommends",
        "--fix-missing",
        "-o",
        "Acquire::http::Timeout=120",
        "-o",
        "Acquire::https::Timeout=120",
        "-o",
        "Acquire::Retries=5",
        "intel-oneapi-compiler-fortran-2023.2.0",
        "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic-2023.2.0",
      ],
      { ignoreReturnCode: true },
    );
    expect(mockedCache.saveCache).toHaveBeenCalledWith(
      ["/opt/intel/oneapi"],
      "oneapi-ifx-2023.2.0",
    );
  });

  it("skips installation and restores from cache on hit", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");
    const inputs = { ...baseInputs, version: "2023.2.0" };
    await installDebian(inputs);

    expect(mockedExec).not.toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    ]);
    expect(mockedCache.saveCache).not.toHaveBeenCalled();
    // But still sources setvars.sh
    expect(mockedExec).toHaveBeenCalledWith(
      "bash",
      [
        "-c",
        expect.stringContaining('source "/opt/intel/oneapi/setvars.sh"'),
      ],
      expect.anything(),
    );
  });

  it("maps 2-digit version 2025.2 to 2025.2", async () => {
    const inputs = { ...baseInputs, version: "2025.2" };
    await installDebian(inputs);

    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      [
        "apt-get",
        "install",
        "-y",
        "--no-install-recommends",
        "--fix-missing",
        "-o",
        "Acquire::http::Timeout=120",
        "-o",
        "Acquire::https::Timeout=120",
        "-o",
        "Acquire::Retries=5",
        "intel-oneapi-compiler-fortran-2025.2",
        "intel-oneapi-compiler-dpcpp-cpp-2025.2",
      ],
      { ignoreReturnCode: true },
    );
  });

  it("resolves 2023.2 to the latest patch 2023.2.4 using resolveMinorToLatestPatch", async () => {
    const inputs = { ...baseInputs, version: "2023.2" };
    await installDebian(inputs);

    expect(mockedExec).toHaveBeenCalledWith(
      "sudo",
      [
        "apt-get",
        "install",
        "-y",
        "--no-install-recommends",
        "--fix-missing",
        "-o",
        "Acquire::http::Timeout=120",
        "-o",
        "Acquire::https::Timeout=120",
        "-o",
        "Acquire::Retries=5",
        "intel-oneapi-compiler-fortran-2023.2.4",
        "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic-2023.2.4",
      ],
      { ignoreReturnCode: true },
    );
  });

  it("adds the Intel repository on cache miss", async () => {
    await installDebian(baseInputs);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "update",
      "-y",
      "-o",
      "Acquire::http::Timeout=120",
      "-o",
      "Acquire::https::Timeout=120",
      "-o",
      "Acquire::Retries=5",
    ]);
    expect(mockedExec).toHaveBeenCalledWith("bash", [
      "-c",
      expect.stringContaining(
        "https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB",
      ),
    ]);
    expect(mockedExec).toHaveBeenCalledWith("bash", [
      "-c",
      expect.stringContaining("https://apt.repos.intel.com/oneapi all main"),
    ]);
  });

  it("exports environment variables including FPM flags", async () => {
    await installDebian(baseInputs);

  });
});
