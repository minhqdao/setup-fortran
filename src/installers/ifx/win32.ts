import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { Arch, LATEST, WindowsEnv, type Target } from "../../types";
import { resolveWindowsVersion } from "../../resolve_version";

const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [WindowsEnv.Native]: [LATEST],
    [WindowsEnv.UCRT64]: undefined,
  },
  [Arch.ARM64]: {
    [WindowsEnv.Native]: undefined,
    [WindowsEnv.UCRT64]: undefined,
  },
} as const satisfies Record<
  Arch,
  Record<WindowsEnv, readonly string[] | undefined>
>;

export async function installWin32(target: Target): Promise<string> {
  const version = resolveWindowsVersion(target, SUPPORTED_VERSIONS);

  // Intel oneAPI on Windows is currently only supported via 'Native'
  // (Standard Windows CMD/Powershell environment) using Chocolatey.
  if (target.windowsEnv !== WindowsEnv.Native) {
    throw new Error(
      `ifx on Windows only supports Native environment via Chocolatey.`,
    );
  }

  return await installChoco(version);
}

async function installChoco(version: string): Promise<string> {
  core.info(`Installing Intel oneAPI Base and HPC Toolkits via Chocolatey...`);

  // HPC Toolkit contains ifx, but requires Base Toolkit for libraries/runtimes.
  // We use '--no-progress' to keep the logs clean in CI.
  const chocoArgs = ["install", "-y", "--no-progress"];

  // If a specific version was requested (not LATEST), pass it to choco.
  if (version !== LATEST) {
    chocoArgs.push("--version", version);
  }

  await exec.exec("choco", [...chocoArgs, "intel-oneapi-base-toolkit"]);
  await exec.exec("choco", [...chocoArgs, "intel-oneapi-hpc-toolkit"]);

  core.info("Initializing Intel environment variables...");
  await setupIntelEnv();

  return await resolveInstalledVersion();
}

/**
 * Sources the setvars.bat file and exports the resulting environment
 * variables to the GitHub Actions environment.
 */
async function setupIntelEnv(): Promise<void> {
  const setvarsPath = "C:\\Program Files (x86)\\Intel\\oneAPI\\setvars.bat";

  let stdout = "";
  // Run setvars.bat and then 'set' to capture all exported variables
  await exec.exec("cmd.exe", ["/c", `call "${setvarsPath}" && set`], {
    silent: true,
    listeners: {
      stdout: (data) => (stdout += data.toString()),
    },
  });

  const lines = stdout.split("\n");
  for (const line of lines) {
    const match = /^([^=]+)=(.*)$/.exec(line);
    if (match) {
      const [, name, value] = match;
      const trimmedName = name.trim();
      const trimmedValue = value.trim();

      // Standardize to uppercase for the comparison to handle
      // 'Path', 'PATH', 'path', etc.
      if (trimmedName.toUpperCase() === "PATH") {
        const paths = trimmedValue.split(";");
        for (const p of paths) {
          if (p) core.addPath(p);
        }
      } else {
        core.exportVariable(trimmedName, trimmedValue);
      }
    }
  }
}

async function resolveInstalledVersion(): Promise<string> {
  let stdout = "";
  try {
    // ifx --version returns a multi-line string; we just want the version line.
    await exec.exec("ifx", ["--version"], {
      silent: true,
      listeners: { stdout: (data) => (stdout += data.toString()) },
    });

    // Example: "ifx (IFX) 2025.1.0 ..." -> we extract the version
    const match = /\d+\.\d+\.\d+/.exec(stdout);
    const version = match ? match[0] : LATEST;

    core.exportVariable("FC", "ifx");
    core.exportVariable("CC", "icx");
    core.exportVariable("CXX", "icpx");
    core.exportVariable("FORTRAN_COMPILER", "ifx");
    core.exportVariable("FORTRAN_COMPILER_VERSION", version);

    return version;
  } catch (err) {
    throw new Error(`Failed to verify ifx installation`, { cause: err });
  }
}
