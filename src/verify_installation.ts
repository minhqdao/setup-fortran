import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { normalizeWindowsExecutablePath } from "./windows_executable_path";

function toBashPath(windowsPath: string): string {
  const normalized = windowsPath.replace(/\\/g, "/");
  return normalized.replace(
    /^([a-z]):\//i,
    (_, drive: string) => `/${drive.toLowerCase()}/`,
  );
}

function verifyNativeWindowsTools(): void {
  if (
    process.platform !== "win32" ||
    process.env.WINDOWS_ENV ||
    !/^(flang|ifort|ifx)$/.test(process.env.FORTRAN_COMPILER ?? "")
  ) {
    return;
  }

  let msvcLink: string | undefined;
  for (const tool of ["link.exe", "lib.exe"]) {
    const resolved = execFileSync("where.exe", [tool], {
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter(Boolean);
    const msvcTool = resolved.find((candidate) =>
      candidate.toLowerCase().includes("\\vc\\tools\\msvc\\"),
    );

    if (!msvcTool) {
      throw new Error(
        `${tool} is not available from the configured MSVC toolchain. ` +
          `Resolved paths: ${resolved.join(", ") || "none"}`,
      );
    }

    if (tool === "link.exe") msvcLink = msvcTool;
  }

  if (!msvcLink) throw new Error("Could not resolve the MSVC linker.");

  const testDir = mkdtempSync(join(tmpdir(), "setup-fortran-link-"));
  const source = join(testDir, "verify_link.f90");
  const executable = join(testDir, "verify_link.exe");

  try {
    writeFileSync(
      source,
      [
        "program verify_link",
        '  print *, "setup-fortran link verification successful"',
        "end program verify_link",
        "",
      ].join("\n"),
    );

    const bashEnvironment = {
      ...process.env,
      VERIFY_SOURCE: toBashPath(source),
      VERIFY_EXECUTABLE: toBashPath(executable),
    };
    const resolvedLink = execFileSync(
      "bash.exe",
      ["--noprofile", "--norc", "-c", "command -v link"],
      {
        encoding: "utf8",
        env: bashEnvironment,
      },
    );
    const expectedLink = toBashPath(msvcLink);
    if (
      normalizeWindowsExecutablePath(resolvedLink) !==
      normalizeWindowsExecutablePath(expectedLink)
    ) {
      throw new Error(
        `Bash resolved link to ${resolvedLink.trim()} instead of ${expectedLink}`,
      );
    }

    execFileSync(
      "bash.exe",
      [
        "--noprofile",
        "--norc",
        "-e",
        "-o",
        "pipefail",
        "-c",
        '"$FC" "$VERIFY_SOURCE" -o "$VERIFY_EXECUTABLE"\n"$VERIFY_EXECUTABLE"',
      ],
      { stdio: "inherit", env: bashEnvironment },
    );
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}

function run(): void {
  try {
    const fc = process.env.FC;
    const cc = process.env.CC;
    const cxx = process.env.CXX;
    const fpmFc = process.env.FPM_FC;
    const fpmCc = process.env.FPM_CC;
    const fpmCxx = process.env.FPM_CXX;
    const f77 = process.env.F77;
    const f90 = process.env.F90;

    const outputFc = process.env.OUTPUT_FC;
    const outputCc = process.env.OUTPUT_CC;
    const outputCxx = process.env.OUTPUT_CXX;
    const outputVersion = process.env.OUTPUT_VERSION;

    const envs: Record<string, string | undefined> = {
      FC: fc,
      CC: cc,
      CXX: cxx,
      FPM_FC: fpmFc,
      FPM_CC: fpmCc,
      FPM_CXX: fpmCxx,
      F77: f77,
      F90: f90,
      OUTPUT_FC: outputFc,
      OUTPUT_CC: outputCc,
      OUTPUT_CXX: outputCxx,
      OUTPUT_VERSION: outputVersion,
    };

    for (const [name, value] of Object.entries(envs)) {
      if (!value) {
        throw new Error(`${name} environment variable is not set.`);
      }
    }

    if (fc !== outputFc) {
      throw new Error(
        `FC (${String(fc)}) does not match OUTPUT_FC (${String(outputFc)})`,
      );
    }
    if (fpmFc !== outputFc) {
      throw new Error(
        `FPM_FC (${String(fpmFc)}) does not match OUTPUT_FC (${String(
          outputFc,
        )})`,
      );
    }
    if (f77 !== outputFc) {
      throw new Error(
        `F77 (${String(f77)}) does not match OUTPUT_FC (${String(outputFc)})`,
      );
    }
    if (f90 !== outputFc) {
      throw new Error(
        `F90 (${String(f90)}) does not match OUTPUT_FC (${String(outputFc)})`,
      );
    }

    if (cc !== outputCc) {
      throw new Error(
        `CC (${String(cc)}) does not match OUTPUT_CC (${String(outputCc)})`,
      );
    }
    if (fpmCc !== outputCc) {
      throw new Error(
        `FPM_CC (${String(fpmCc)}) does not match OUTPUT_CC (${String(
          outputCc,
        )})`,
      );
    }

    if (cxx !== outputCxx) {
      throw new Error(
        `CXX (${String(cxx)}) does not match OUTPUT_CXX (${String(outputCxx)})`,
      );
    }
    if (fpmCxx !== outputCxx) {
      throw new Error(
        `FPM_CXX (${String(fpmCxx)}) does not match OUTPUT_CXX (${String(
          outputCxx,
        )})`,
      );
    }

    verifyNativeWindowsTools();

    console.log("Installation verification successful!");
  } catch (error) {
    if (error instanceof Error) {
      console.error(`::error::Verification failed: ${error.message}`);
    } else {
      console.error(`::error::Verification failed: ${String(error)}`);
    }
    process.exit(1);
  }
}

run();
