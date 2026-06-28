const cp = require("child_process");
const path = require("path");
const fs = require("fs");

const Compiler = {
  GFortran: "gfortran",
  IFX: "ifx",
  IFort: "ifort",
  NVFortran: "nvfortran",
  AOCC: "aocc",
  Flang: "flang",
  LFortran: "lfortran",
};

const OS = {
  Linux: "linux",
  MacOS: "darwin",
  Windows: "win32",
};

const Msystem = {
  Native: "native",
  UCRT64: "ucrt64",
  Clang64: "clang64",
};

const LATEST = "latest";

function getCompilerFlags(compiler, isWindows) {
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
      throw new Error(`Unsupported compiler: ${compiler}`);
  }
}

function getCppFlags(compiler, isWindows) {
  if (compiler === Compiler.LFortran) return ["--cpp"];
  if ((compiler === Compiler.IFX || compiler === Compiler.IFort) && isWindows)
    return ["-fpp"];
  return [];
}

async function exec(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(" ")}`);
    const child = cp.spawn(command, args, { stdio: "inherit", ...options });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

async function run() {
  const buildDir = path.join(process.cwd(), "test_build");

  try {
    const fc = process.env.FC;
    if (!fc) throw new Error("FC environment variable is not set.");

    const compiler = process.env.FORTRAN_COMPILER;
    if (!compiler)
      throw new Error("FORTRAN_COMPILER environment variable is not set.");

    function parseFlangVersion(raw) {
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
    const msystem = process.env.WINDOWS_ENV;
    const isUCRT64 = msystem === Msystem.UCRT64;
    const isMSYS2 = isUCRT64 || msystem === Msystem.Clang64;

    const platform = process.platform;
    const isWindows = platform === OS.Windows;
    const isDarwin = platform === OS.MacOS;

    const testDir = path.join(process.cwd(), "fortran_tests");

    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir);
    }

    console.log(`Starting integration tests for ${fc} in ${buildDir}...`);

    const {
      module: moduleFlags,
      openmp: ompFlag,
      linkerFlags: linkerFlags,
    } = getCompilerFlags(compiler, isWindows);
    const cppFlags = getCppFlags(compiler, isWindows);
    const baseFlags = ["-O2", ...moduleFlags];

    const execTest = async (name, sources, extraFlags = []) => {
      const outputPath = path.join(buildDir, isWindows ? `${name}.exe` : name);
      const sourcePaths = sources.map((s) => path.join(testDir, s));
      const fflags = (process.env.FFLAGS ?? "").split(" ").filter(Boolean);

      console.log(`::group::Test: ${name}`);
      await exec(fc, [
        ...baseFlags,
        ...fflags,
        ...extraFlags,
        ...linkerFlags,
        ...sourcePaths,
        "-o",
        outputPath,
      ]);
      await exec(outputPath, []);
      console.log("::endgroup::");
    };

    const skipTest = (name, reason) => {
      console.log(`Skipping ${name}: ${reason}`);
    };

    await execTest("iso_fortran_env_test", ["iso_fortran_env_test.f90"]);
    await execTest("math_test", ["math_test.f90"]);
    await execTest("c_interop_test", ["c_interop_test.F90"], cppFlags);

    const skipPoly =
      compiler === Compiler.Flang &&
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
        `not supported by ${compiler} ${String(flangVersion)} on ${platform}`,
      );
    }

    const isUnsupportedFlangOnDarwin =
      isDarwin && flangVersion && flangVersion !== LATEST && flangVersion < 23;
    const skipOmp =
      compiler === Compiler.LFortran ||
      (compiler === Compiler.Flang &&
        (isUnsupportedFlangOnDarwin === true || isMSYS2));
    if (!skipOmp) {
      await execTest("omp_test", ["omp_test.f90"], ompFlag);
    } else {
      skipTest(
        "omp_test",
        `not supported by ${compiler} ${String(flangVersion)} on ${platform}`,
      );
    }

    console.log("All integration tests passed successfully!");
  } catch (error) {
    console.error(`::error::Integration tests failed: ${error.message}`);
    process.exit(1);
  } finally {
    if (fs.existsSync(buildDir)) {
      console.log("Cleaning up test artifacts...");
      fs.rmSync(buildDir, { recursive: true, force: true });
    }
  }
}

run();
