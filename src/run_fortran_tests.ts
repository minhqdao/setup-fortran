import * as exec from "@actions/exec";
import * as core from "@actions/core";
import * as path from "path";
import * as fs from "fs";
import { Compiler, LATEST, OS, WindowsEnv } from "./types";

interface CompilerFlags {
  module: string[];
  openmp: string[];
}

function getCompilerFlags(
  compiler: Compiler,
  isWindows: boolean,
): CompilerFlags {
  switch (compiler) {
    case Compiler.IFX:
    case Compiler.IFort:
      return {
        module: isWindows ? ["-module:test_build"] : ["-module", "test_build"],
        openmp: [isWindows ? "-Qopenmp" : "-qopenmp"],
      };
    case Compiler.NVFortran:
      return { module: ["-J", "test_build"], openmp: ["-mp"] };
    case Compiler.LFortran:
      return {
        module: ["-J", "test_build"],
        openmp: [
          "--openmp",
          `--openmp-lib-dir=${process.env.LFORTRAN_OMP_LIB_DIR ?? ""}`,
        ],
      };
    case "gfortran":
    case "aocc":
    case "flang":
      return { module: ["-J", "test_build"], openmp: ["-fopenmp"] };
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

    const compiler = (process.env.FORTRAN_COMPILER ?? "") as Compiler;
    const rawVersion = process.env.FORTRAN_COMPILER_VERSION ?? "0";
    const isUCRT64 = process.env.WINDOWS_ENV === WindowsEnv.UCRT64;

    const rawPlatform = process.platform;
    if (!Object.values(OS).includes(rawPlatform as OS)) {
      throw new Error(`Unsupported or missing platform: ${rawPlatform}`);
    }

    const platform = rawPlatform as OS;
    const isWindows = platform === OS.Windows;
    const isDarwin = platform === OS.MacOS;
    const isLatest = rawVersion === LATEST;
    const majorVersion = isLatest ? Infinity : parseInt(rawVersion, 10);
    const isFlang = compiler === Compiler.Flang;

    const testDir = path.join(process.cwd(), "fortran_tests");

    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir);
    }

    core.info(`Starting integration tests for ${fc} in ${buildDir}...`);

    const { module: moduleFlags, openmp: ompFlag } = getCompilerFlags(
      compiler,
      isWindows,
    );
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

    // iso_fortran_env: requires flang/LLVM 16+
    if (!isFlang || isLatest || majorVersion >= 16) {
      await execTest("iso_fortran_env_test", ["iso_fortran_env_test.f90"]);
    } else {
      skipTest(
        "iso_fortran_env_test",
        `not supported by flang ${majorVersion.toString()} (requires LLVM 16+)`,
      );
    }

    await execTest("math_test", ["math_test.f90"]);
    await execTest("c_interop_test", ["c_interop_test.F90"], cppFlags);

    const skipPoly = isFlang && (majorVersion < 19 || isUCRT64);
    // Polymorphic types (CLASS): requires flang/LLVM 19+; currently broken on UCRT64.
    if (!skipPoly) {
      await execTest("polymorphism_test", [
        "polymorphism_mod_test.f90",
        "polymorphism_test.f90",
      ]);
    } else {
      skipTest(
        "polymorphism_test",
        `not supported by flang ${majorVersion.toString()} (requires LLVM 19+)`,
      );
    }

    const isUnsupportedDarwin = isDarwin && majorVersion < 23; // LATEST from brew works, let's check with version 23 if installation from source works, too
    const skipOmp = isFlang && (isUnsupportedDarwin || isUCRT64);
    if (!skipOmp) {
      await execTest("omp_test", ["omp_test.f90"], ompFlag);
    } else {
      skipTest(
        "omp_test",
        `not supported by flang ${majorVersion.toString()} on ${process.platform}`,
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
