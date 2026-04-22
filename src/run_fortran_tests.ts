import * as exec from "@actions/exec";
import * as core from "@actions/core";
import * as path from "path";
import * as fs from "fs"; // Added for directory management
import { parseInputs } from "./parse_input";
import { Compiler } from "./types";

async function run(): Promise<void> {
  const buildDir = path.join(process.cwd(), "test_build");

  try {
    const target = parseInputs();
    const fc = target.compiler;
    const testDir = path.join(process.cwd(), "fortran_tests");

    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir);
    }

    core.info(`Starting integration tests for ${fc} in ${buildDir}...`);

    const flags: string[] = ["-O2"];

    if (fc === Compiler.GFortran || fc === Compiler.AOCC) {
      flags.push("-J", "test_build");
    } else if (fc === Compiler.IFX || fc === Compiler.IFort) {
      flags.push("-module", "test_build");
    }

    let ompFlag = "";
    if (fc === Compiler.GFortran || fc === Compiler.AOCC) {
      ompFlag = "-fopenmp";
    } else if (fc === Compiler.IFX || fc === Compiler.IFort) {
      ompFlag = "-qopenmp";
    } else if (fc === Compiler.NVFortran) {
      ompFlag = "-mp";
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

    await execTest("iso_fortran_env_test", ["iso_fortran_env_test.f90"]);
    await execTest("math_test", ["math_test.f90"]);
    await execTest("c_interop_test", ["c_interop_test.F90"]);
    await execTest("polymorphism_test", [
      "polymorphism_mod_test.f90",
      "polymorphism_test.f90",
    ]);

    if (ompFlag) {
      await execTest("omp_test", ["omp_test.f90"], [ompFlag]);
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
