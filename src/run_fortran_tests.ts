import * as exec from "@actions/exec";
import * as core from "@actions/core";
import * as path from "path";
import * as fs from "fs";
import { Compiler, LATEST, OS, Msystem, type Latest } from "./types";

interface CompilerFlags {
  module: string[];
  openmp: string[];
  linkerFlags: string[];
}

function getCompilerFlags(
  compiler: Compiler,
  isWindows: boolean,
): CompilerFlags {
  const lFortranLinker = process.env.LFORTRAN_LINKER;

  switch (compiler) {
    case Compiler.IFX:
    case Compiler.IFort:
      return {
        module: isWindows ? ["-module:test_build"] : ["-module", "test_build"],
        openmp: [isWindows ? "-Qopenmp" : "-qopenmp"],
        linkerFlags: [],
      };
    case Compiler.NVFortran:
      return {
        module: ["-module", "test_build"],
        openmp: ["-mp"],
        linkerFlags: [],
      };
    case Compiler.LFortran:
      return {
        module: ["-J", "test_build"],
        openmp: [
          "--openmp",
          `--openmp-lib-dir=${process.env.LFORTRAN_OMP_LIB_DIR ?? ""}`,
        ],
        linkerFlags:
          isWindows && lFortranLinker ? [`--linker=${lFortranLinker}`] : [],
      };
    case Compiler.GFortran:
    case Compiler.AOCC:
    case Compiler.Flang:
      return {
        module: ["-J", "test_build"],
        openmp: ["-fopenmp"],
        linkerFlags: [],
      };
    default:
      throw new Error(`Unsupported compiler: ${compiler as string}`);
  }
}

// Returns extra flags needed to compile a file that uses the C preprocessor.
// Capital-F extensions (.F90) imply preprocessing for gfortran/flang, but
// lfortran requires an explicit flag; Intel on Windows uses -fpp instead of -cpp.
function getCppFlags(compiler: Compiler, isWindows: boolean): string[] {
  if (compiler === Compiler.LFortran) return ["--cpp"];
  if ((compiler === Compiler.IFX || compiler === Compiler.IFort) && isWindows)
    return ["-fpp"];
  return [];
}

async function run(): Promise<void> {
  const buildDir = path.join(process.cwd(), "test_build");

  try {
    const fc = process.env.FC;
    if (!fc) {
      throw new Error(
        "FC environment variable is not set. Please fix the installer.",
      );
    }

    const compiler = process.env.FORTRAN_COMPILER as Compiler | undefined;
    if (!compiler) {
      throw new Error(
        "FORTRAN_COMPILER environment variable is not set. Please fix the installer.",
      );
    }

    function parseFlangVersion(
      raw: string | undefined,
    ): Latest | number | undefined {
      if (raw === undefined) return undefined;
      if (raw === LATEST) return LATEST;
      const n = parseInt(raw, 10);
      if (isNaN(n))
        throw new Error(
          `Invalid FLANG_VERSION: "${raw}". Expected "latest" or an integer.`,
        );
      return n;
    }

    const flangVersion = parseFlangVersion(process.env.FLANG_VERSION);
    const msystem = process.env.WINDOWS_ENV as Msystem | undefined;
    const isUCRT64 = msystem === Msystem.UCRT64;
    const isMSYS2 = isUCRT64 || msystem === Msystem.Clang64;

    const rawPlatform = process.platform;
    if (!Object.values(OS).includes(rawPlatform as OS)) {
      throw new Error(`Unsupported or missing platform: ${rawPlatform}`);
    }

    const platform = rawPlatform as OS;
    const isWindows = platform === OS.Windows;
    const isDarwin = platform === OS.MacOS;
    const isLFortran = compiler === Compiler.LFortran;
    const isFlang = compiler === Compiler.Flang;

    const testDir = path.join(process.cwd(), "fortran_tests");

    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir);
    }

    core.info(`Starting integration tests for ${fc} in ${buildDir}...`);

    const {
      module: moduleFlags,
      openmp: ompFlag,
      linkerFlags: linkerFlags,
    } = getCompilerFlags(compiler, isWindows);
    const cppFlags = getCppFlags(compiler, isWindows);
    const baseFlags = ["-O2", ...moduleFlags];

    const execTest = async (
      name: string,
      sources: string[],
      extraFlags: string[] = [],
    ): Promise<void> => {
      const outputPath = path.join(buildDir, isWindows ? `${name}.exe` : name);
      const sourcePaths = sources.map((s) => path.join(testDir, s));
      const fflags = (process.env.FFLAGS ?? "").split(" ").filter(Boolean);

      core.startGroup(`Test: ${name}`);
      await exec.exec(fc, [
        ...baseFlags,
        ...fflags,
        ...extraFlags,
        ...linkerFlags,
        ...sourcePaths,
        "-o",
        outputPath,
      ]);
      await exec.exec(outputPath);
      core.endGroup();
    };

    const skipTest = (name: string, reason: string): void => {
      core.info(`Skipping ${name}: ${reason}`);
    };

    await execTest("iso_fortran_env_test", ["iso_fortran_env_test.f90"]);
    await execTest("math_test", ["math_test.f90"]);
    await execTest("c_interop_test", ["c_interop_test.F90"], cppFlags);

    const skipPoly =
      isFlang &&
      ((flangVersion !== undefined &&
        flangVersion !== LATEST &&
        flangVersion < 19) ||
        isUCRT64);

    if (!skipPoly) {
      await execTest("polymorphism_test", [
        "polymorphism_mod_test.f90",
        "polymorphism_test.f90",
      ]);
    } else {
      skipTest(
        "polymorphism_test",
        `not supported by ${compiler} ${(flangVersion ?? "").toString()} on ${process.platform}`,
      );
    }

    const isUnsupportedFlangOnDarwin =
      isDarwin && flangVersion && flangVersion !== LATEST && flangVersion < 23; // LATEST from brew works, let's check with version 23 if installation from source works, too
    const skipOmp =
      isLFortran ||
      (isFlang && (isUnsupportedFlangOnDarwin === true || isMSYS2));
    if (!skipOmp) {
      await execTest("omp_test", ["omp_test.f90"], ompFlag);
    } else {
      skipTest(
        "omp_test",
        `not supported by ${compiler} ${(
          flangVersion ?? ""
        ).toString()} on ${process.platform}`,
      );
    }

    core.info("All integration tests passed successfully!");
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Integration tests failed: ${error.message}`);
    }
    process.exit(1);
  } finally {
    if (fs.existsSync(buildDir)) {
      core.info("Cleaning up test artifacts...");
      fs.rmSync(buildDir, { recursive: true, force: true });
    }
  }
}

void run();
