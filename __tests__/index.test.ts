import * as core from "@actions/core";
import type { Inputs, InstallationResult } from "../src/types";
import { Arch, Compiler, Msystem, OS } from "../src/types";

jest.mock("@actions/core");
jest.mock("../src/parse_inputs", () => ({ parseInputs: jest.fn() }));
jest.mock("../src/installers/gfortran", () => ({
  installGFortran: jest.fn(),
}));
jest.mock("../src/installers/ifx", () => ({ installIFX: jest.fn() }));
jest.mock("../src/installers/ifort", () => ({ installIFort: jest.fn() }));
jest.mock("../src/installers/nvfortran", () => ({
  installNVFortran: jest.fn(),
}));
jest.mock("../src/installers/aocc", () => ({ installAOCC: jest.fn() }));
jest.mock("../src/installers/flang", () => ({ installFlang: jest.fn() }));
jest.mock("../src/installers/lfortran", () => ({
  installLFortran: jest.fn(),
}));
jest.mock("../src/installers/armflang", () => ({
  installArmFlang: jest.fn(),
}));
jest.mock("../src/installation_result", () => ({
  setInstallationOutputs: jest.fn(),
  exportInstallationVariables: jest.fn(),
}));

describe("action invocation", () => {
  const previousSmokeTest = process.env.SETUP_FORTRAN_BUNDLE_SMOKE_TEST;

  beforeAll(() => {
    process.env.SETUP_FORTRAN_BUNDLE_SMOKE_TEST = "1";
  });

  afterAll(() => {
    if (previousSmokeTest === undefined) {
      delete process.env.SETUP_FORTRAN_BUNDLE_SMOKE_TEST;
    } else {
      process.env.SETUP_FORTRAN_BUNDLE_SMOKE_TEST = previousSmokeTest;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    [Compiler.GFortran, "../src/installers/gfortran", "installGFortran"],
    [Compiler.IFX, "../src/installers/ifx", "installIFX"],
    [Compiler.IFort, "../src/installers/ifort", "installIFort"],
    [Compiler.NVFortran, "../src/installers/nvfortran", "installNVFortran"],
  ] as const)(
    "dispatches normalized %s inputs to %s",
    async (compiler, installerModule, installerName) => {
      const { parseInputs } = jest.requireMock("../src/parse_inputs") as {
        parseInputs: jest.Mock<Inputs>;
      };
      const installer = (
        jest.requireMock(installerModule) as Record<
          string,
          jest.Mock<Promise<InstallationResult>>
        >
      )[installerName];
      const inputs: Inputs = {
        compiler,
        version: "latest",
        os: OS.Linux,
        osVersion: "24.04",
        arch: Arch.X64,
        msystem: Msystem.Native,
        cleanupDisk: false,
      };
      const result: InstallationResult = {
        version: "1.2.3",
        fc: "fc",
        cc: "cc",
        cxx: "cxx",
      };
      parseInputs.mockReturnValue(inputs);
      installer.mockResolvedValue(result);

      const { run } = await import("../src/index");
      await run();

      expect(installer).toHaveBeenCalledTimes(1);
      expect(installer).toHaveBeenCalledWith(inputs);
      expect(core.setFailed).not.toHaveBeenCalled();
    },
  );

  it("can run twice in one process without retaining invocation state", async () => {
    const { parseInputs } = jest.requireMock("../src/parse_inputs") as {
      parseInputs: jest.Mock<Inputs>;
    };
    const { installGFortran } = jest.requireMock(
      "../src/installers/gfortran",
    ) as { installGFortran: jest.Mock<Promise<InstallationResult>> };
    const { setInstallationOutputs, exportInstallationVariables } =
      jest.requireMock("../src/installation_result") as {
        setInstallationOutputs: jest.Mock;
        exportInstallationVariables: jest.Mock;
      };
    const inputs: Inputs = {
      compiler: Compiler.GFortran,
      version: "14",
      os: OS.Linux,
      osVersion: "24.04",
      arch: Arch.X64,
      msystem: Msystem.Native,
      cleanupDisk: false,
    };
    const result: InstallationResult = {
      version: "14.2.0",
      fc: "gfortran-14",
      cc: "gcc-14",
      cxx: "g++-14",
    };
    parseInputs.mockReturnValue(inputs);
    installGFortran.mockResolvedValue(result);

    const { run } = await import("../src/index");
    await run();
    await run();

    expect(parseInputs).toHaveBeenCalledTimes(2);
    expect(installGFortran).toHaveBeenCalledTimes(2);
    expect(setInstallationOutputs).toHaveBeenNthCalledWith(1, result);
    expect(setInstallationOutputs).toHaveBeenNthCalledWith(2, result);
    expect(exportInstallationVariables).toHaveBeenCalledTimes(2);
  });
});
