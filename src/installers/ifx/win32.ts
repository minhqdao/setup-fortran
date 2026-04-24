import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as fs from "fs";
import { Arch, LATEST, WindowsEnv, type Target } from "../../types";
import { resolveWindowsVersion } from "../../resolve_version";

// For Windows, we'll use winget as it's the easiest way to install IFX.
// Supported versions will mostly be "latest" or specific versions winget supports.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [WindowsEnv.Native]: [LATEST],
    [WindowsEnv.UCRT64]: [LATEST],
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
  core.info(`Installing IFX ${version} on Windows (${target.arch}, ${target.windowsEnv})...`);

  // winget install Intel.FortranCompiler
  const wingetArgs = ["install", "--id", "Intel.FortranCompiler", "--accept-package-agreements", "--accept-source-agreements"];
  if (version !== LATEST) {
    wingetArgs.push("--version", version);
  }

  await exec.exec("winget", wingetArgs);

  // The default installation directory for oneAPI on Windows
  const oneApiRoot = "C:\\Program Files (x86)\\Intel\\oneAPI";
  const varsBatPath = path.join(oneApiRoot, "setvars.bat");

  if (!fs.existsSync(varsBatPath)) {
    throw new Error(`setvars.bat not found at ${varsBatPath}. Installation might have failed.`);
  }

  core.info(`Sourcing ${varsBatPath} and exporting environment...`);

  // In Windows, we use 'cmd /c "setvars.bat && set"' to get environment variables
  let envOutput = "";
  await exec.exec("cmd", ["/c", `"${varsBatPath}" && set`], {
    listeners: {
      stdout: (data: Buffer) => {
        envOutput += data.toString();
      },
    },
  });

  const lines = envOutput.split("\r\n");
  for (const line of lines) {
    const eqIdx = line.indexOf("=");
    if (eqIdx !== -1) {
      const key = line.substring(0, eqIdx);
      const value = line.substring(eqIdx + 1);

      if (
        key === "PATH" ||
        key === "LIB" ||
        key === "INCLUDE" ||
        key.startsWith("INTEL") ||
        key.startsWith("ONEAPI")
      ) {
        if (key === "PATH") {
          const newPaths = value.split(";");
          // On Windows, PATH is case-insensitive, but process.env.PATH usually works.
          // We add each part to GITHUB_PATH.
          for (const p of newPaths) {
            if (p && fs.existsSync(p)) {
              core.addPath(p);
            }
          }
        } else {
          core.exportVariable(key, value);
        }
      }
    }
  }

  core.exportVariable("FC", "ifx");
  core.exportVariable("CC", "icx");
  core.exportVariable("CXX", "icpx");

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`IFX ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("ifx", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
