import * as exec from "@actions/exec";
import * as core from "@actions/core";
import * as path from "path";
import * as fs from "fs";
import { Compiler } from "./types";

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
    const compilerVersion = parseInt(
      process.env.FORTRAN_COMPILER_VERSION ?? "0",
      10,
    );
    const isFlang = compiler === Compiler.Flang;

    const testDir = path.join(process.cwd(), "fortran_tests");

    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir);
    }

    core.info(`Starting integration tests for ${fc} in ${buildDir}...`);

    // Module output flag varies by compiler family.
    const flags: string[] = ["-O2"];
    if (compiler === Compiler.IFX || compiler === Compiler.IFort) {
      flags.push("-module", "test_build");
    } else {
      // gfortran, aocc, flang, nvfortran all use -J
      flags.push("-J", "test_build");
    }

    // OpenMP flag varies by compiler family.
    let ompFlag = "";
    if (compiler === Compiler.NVFortran) {
      ompFlag = "-mp";
    } else if (compiler === Compiler.IFX || compiler === Compiler.IFort) {
      ompFlag = "-qopenmp";
    } else {
      // gfortran, aocc, flang
      ompFlag = "-fopenmp";
    }

    const execTest = async (
      name: string,
      sources: string[],
      extraFlags: string[] = [],
    ): Promise<void> => {
      const binaryName = process.platform === "win32" ? `${name}.exe` : name;
      const outputPath = path.join(buildDir, binaryName);
      const sourcePaths = sources.map((s) => path.join(testDir, s));

      core.startGroup(`Test: ${name}`);
      await exec.exec(fc, [
        ...flags,
        ...extraFlags,
        ...sourcePaths,
        "-o",
        outputPath,
      ]);
      await exec.exec(outputPath);
      core.endGroup();
    };

    if (!isFlang || compilerVersion >= 16) {
      await execTest("iso_fortran_env_test", ["iso_fortran_env_test.f90"]);
    } else {
      core.info(
        `Skipping iso_fortran_env_test: not supported by flang ${compilerVersion.toString()} (requires LLVM 16+).`,
      );
    }

    await execTest("math_test", ["math_test.f90"]);
    await execTest("c_interop_test", ["c_interop_test.F90"]);

    // Polymorphic types (CLASS) were not implemented in flang until LLVM 19.
    if (!isFlang || compilerVersion >= 19) {
      await execTest("polymorphism_test", [
        "polymorphism_mod_test.f90",
        "polymorphism_test.f90",
      ]);
    } else {
      core.info(
        `Skipping polymorphism_test: not supported by flang ${compilerVersion.toString()} (requires LLVM 19+).`,
      );
    }

    await execTest("omp_test", ["omp_test.f90"], [ompFlag]);
    // // OpenMP support in flang was incomplete before LLVM 16.
    // if (ompFlag && (!isFlang || compilerVersion >= 16)) {
    //   await execTest("omp_test", ["omp_test.f90"], [ompFlag]);
    // } else if (ompFlag) {
    //   core.info(
    //     `Skipping omp_test: not supported by flang ${compilerVersion.toString()} (requires LLVM 16+).`,
    //   );
    // }

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
