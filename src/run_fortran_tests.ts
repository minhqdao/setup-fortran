import * as exec from "@actions/exec";
import * as core from "@actions/core";
import * as path from "path";
import * as fs from "fs";
import { Compiler, LATEST, OS, WindowsEnv } from "./types";

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
    const isSupportedOS = Object.values(OS).includes(rawPlatform as OS);

    if (!isSupportedOS) {
      throw new Error(`Unsupported or missing platform: ${rawPlatform}`);
    }

    const platform = rawPlatform as OS;
    const isDarwin = platform === OS.MacOS;
    const isWindows = platform === OS.Windows;
    const isLatest = rawVersion === LATEST;
    const majorVersion = isLatest ? Infinity : parseInt(rawVersion, 10);
    const isFlang = compiler === Compiler.Flang;

    const testDir = path.join(process.cwd(), "fortran_tests");

    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir);
    }

    core.info(`Starting integration tests for ${fc} in ${buildDir}...`);

    const flags: string[] = ["-O2"];
    if (compiler === Compiler.IFX || compiler === Compiler.IFort) {
      if (isWindows) {
        flags.push("-module:test_build", "-fpp");
      } else {
        flags.push("-module", "test_build");
      }
    } else {
      flags.push("-J", "test_build");
    }

    // OpenMP flag varies by compiler family.
    let ompFlag = "";
    if (compiler === Compiler.NVFortran) {
      ompFlag = "-mp";
    } else if (compiler === Compiler.IFX || compiler === Compiler.IFort) {
      ompFlag = isWindows ? "-Qopenmp" : "-qopenmp";
    } else {
      ompFlag = "-fopenmp";
    }

    const execTest = async (
      name: string,
      sources: string[],
      extraFlags: string[] = [],
    ): Promise<void> => {
      const binaryName = isWindows ? `${name}.exe` : name;
      const outputPath = path.join(buildDir, binaryName);
      const sourcePaths = sources.map((s) => path.join(testDir, s));

      const fflags = (process.env.FFLAGS ?? "").split(" ").filter(Boolean);
      core.startGroup(`Test: ${name}`);
      await exec.exec(fc, [
        ...flags,
        ...fflags,
        ...extraFlags,
        ...sourcePaths,
        "-o",
        outputPath,
      ]);
      await exec.exec(outputPath);
      core.endGroup();
    };

    if (!isFlang || isLatest || majorVersion >= 16) {
      await execTest("iso_fortran_env_test", ["iso_fortran_env_test.f90"]);
    } else {
      core.info(
        `Skipping iso_fortran_env_test: not supported by flang ${majorVersion.toString()} (requires LLVM 16+).`,
      );
    }

    await execTest("math_test", ["math_test.f90"]);
    await execTest("c_interop_test", ["c_interop_test.F90"]);

    const shouldSkipPoly = isFlang && (majorVersion < 19 || isUCRT64);

    // Polymorphic types (CLASS) were not implemented in flang until LLVM 19. Currently broken on UCRT64.
    if (!shouldSkipPoly) {
      await execTest("polymorphism_test", [
        "polymorphism_mod_test.f90",
        "polymorphism_test.f90",
      ]);
    } else {
      core.info(
        `Skipping polymorphism_test: not supported by flang ${majorVersion.toString()} (requires LLVM 19+).`,
      );
    }

    const isUnsupportedDarwin = isDarwin && majorVersion < 23; // LATEST from brew works, let's check with version 23 if installation from source works, too
    const shouldSkipOmp = isFlang && (isUnsupportedDarwin || isUCRT64);

    if (ompFlag && !shouldSkipOmp) {
      await execTest("omp_test", ["omp_test.f90"], [ompFlag]);
    } else if (ompFlag) {
      core.info(
        `Skipping omp_test: not supported by flang ${majorVersion.toString()} on ${process.platform}.`,
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
