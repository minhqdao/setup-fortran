import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import { installDebian } from "../../../src/installers/ifort/debian";
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

describe("installDebian (ifort)", () => {
  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedCache = cache as jest.Mocked<typeof cache>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseTarget: Target = {
    compiler: Compiler.IFort,
    version: "2021.10",
    os: OS.Linux,
    osVersion: "22.04",
    arch: Arch.X64,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCache.restoreCache.mockResolvedValue(undefined);
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

  it("adds the Intel repository on cache miss", async () => {
    await installDebian(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "update",
      "-y",
      "-o",
      "Acquire::http::Timeout=60",
      "-o",
      "Acquire::Retries=3",
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

  it("installs the correct packages and saves to cache on miss", async () => {
    await installDebian(baseTarget);

    expect(mockedCache.restoreCache).toHaveBeenCalledWith(
      ["/opt/intel/oneapi"],
      "oneapi-ifort-2023.2.4",
    );
    expect(mockedExec).toHaveBeenCalledWith("sudo", [
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      "intel-oneapi-compiler-fortran-2023.2.4",
      "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic-2023.2.4",
    ]);
    expect(mockedCache.saveCache).toHaveBeenCalledWith(
      ["/opt/intel/oneapi"],
      "oneapi-ifort-2023.2.4",
    );
  });

  it("skips installation and restores from cache on hit", async () => {
    mockedCache.restoreCache.mockResolvedValue("hit");
    await installDebian(baseTarget);

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

  it("exports environment variables", async () => {
    await installDebian(baseTarget);

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

  it("applies OpenMP workaround for 2024.1 bundle", async () => {
    // 2021.12 ifort corresponds to 2024.1 bundle
    const target = { ...baseTarget, version: "2021.12" };
    await installDebian(target);

    expect(mockedExportVariable).toHaveBeenCalledWith(
      "FFLAGS",
      expect.stringContaining("intel64"),
    );
  });

  it("resolves and returns the installed version", async () => {
    const version = await installDebian(baseTarget);
    expect(version).toBe("ifort (IFORT) 2021.10.0 20230609");
  });
});
