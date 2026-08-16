import { installAOCC } from "../../src/installers/aocc";
import { installArmFlang } from "../../src/installers/armflang";
import { installNVFortran } from "../../src/installers/nvfortran";
import * as aoccDebian from "../../src/installers/aocc/debian";
import * as armflangDebian from "../../src/installers/armflang/debian";
import * as nvfortranDebian from "../../src/installers/nvfortran/debian";
import { Arch, Compiler, Msystem, OS, type Inputs } from "../../src/types";

function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    compiler: Compiler.GFortran,
    version: "latest",
    os: OS.Linux,
    osVersion: "24.04",
    arch: Arch.X64,
    msystem: Msystem.Native,
    cleanupDisk: false,
    ...overrides,
  };
}

// The platform guards are the FIRST statement of each installer's dispatch.
// Asserting the exact guard message (which can only originate there) together
// with a spy showing the platform-specific installer was never called proves
// that an unsupported compiler/OS/arch combination is rejected before any cache
// restore, download, package-repository change, or other mutation.
describe("platform guards fail fast before any mutation", () => {
  it.each([
    [Compiler.NVFortran, installNVFortran, nvfortranDebian],
    [Compiler.AOCC, installAOCC, aoccDebian],
    [Compiler.ArmFlang, installArmFlang, armflangDebian],
  ])(
    "%s on macOS is rejected before its installer runs",
    async (compiler, install, module) => {
      const spy = jest.spyOn(module, "installDebian");
      await expect(
        install(makeInputs({ compiler, os: OS.MacOS, arch: Arch.X64 })),
      ).rejects.toThrow(
        `${compiler} is only supported on Linux. Got: ${OS.MacOS}`,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    },
  );

  it.each([
    [Compiler.NVFortran, installNVFortran, nvfortranDebian],
    [Compiler.AOCC, installAOCC, aoccDebian],
    [Compiler.ArmFlang, installArmFlang, armflangDebian],
  ])(
    "%s on Windows is rejected before its installer runs",
    async (compiler, install, module) => {
      const spy = jest.spyOn(module, "installDebian");
      await expect(
        install(makeInputs({ compiler, os: OS.Windows, arch: Arch.X64 })),
      ).rejects.toThrow(
        `${compiler} is only supported on Linux. Got: ${OS.Windows}`,
      );
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    },
  );

  // armflang's OS guard passes on Linux; the arch guard lives in resolveVersion,
  // which is the first statement of installDebian — before any I/O.
  it("rejects armflang on Linux x64 via resolveVersion (arch-level preflight)", async () => {
    const spy = jest.spyOn(armflangDebian, "installDebian");
    await expect(
      installArmFlang(
        makeInputs({ compiler: Compiler.ArmFlang, os: OS.Linux, arch: Arch.X64 }),
      ),
    ).rejects.toThrow(
      /No supported versions found for armflang on linux \(x64\)/,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
