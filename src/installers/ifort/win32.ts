import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as tc from "@actions/tool-cache";
import { Arch, WindowsEnv, type Target } from "../../types";
import { resolveWindowsVersion } from "../../resolve_version";
import * as fs from "fs";
import * as os from "os";
import path from "path";

// ifort (Intel Fortran Compiler Classic) was discontinued in 2024.
// Only legacy versions (2023 and earlier) are listed here.
// LATEST resolves to the first entry (2023.2.1).
const IFORT_RELEASES = [
  {
    version: "2023.2.1",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/1720594b-b12c-4aca-b7fb-a7d317bac5cb/w_fortran-compiler_p_2023.2.1.7_offline.exe",
  },
  {
    version: "2023.2.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/438527fc-7140-422c-a851-389f2791816b/w_HPCKit_p_2023.2.0.49441_offline.exe",
  },
  {
    version: "2023.1.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/2a13d966-fcc5-4a66-9fcc-50603820e0c9/w_HPCKit_p_2023.1.0.46357_offline.exe",
  },
  {
    version: "2022.3.1",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18970/w_HPCKit_p_2022.3.1.15391_offline.exe",
  },
  {
    version: "2022.3.0",
    url: "https://registrationcenter-download.intel.com/akdlm/irc_nas/18857/w_HPCKit_p_2022.3.0.9564_offline.exe",
  },
  {
    version: "2022.2.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18680/w_HPCKit_p_2022.2.0.173_offline.exe",
  },
  {
    version: "2022.1.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18484/w_HPCKit_p_2022.1.0.86_offline.exe",
  },
  {
    version: "2021.4.0",
    url: "https://registrationcenter-download.intel.com/akdlm/irc_nas/18231/w_HPCKit_p_2021.4.0.3340_offline.exe",
  },
] as const;

const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [WindowsEnv.Native]: IFORT_RELEASES.map((r) => r.version),
    [WindowsEnv.UCRT64]: undefined, // ifort does not support MSYS2/UCRT64
  },
  [Arch.ARM64]: {
    [WindowsEnv.Native]: undefined,
    [WindowsEnv.UCRT64]: undefined,
  },
} satisfies Record<Arch, Record<WindowsEnv, readonly string[] | undefined>>;

const ONEAPI_ROOT = "C:\\Program Files (x86)\\Intel\\oneAPI";
const SETVARS_BAT = `${ONEAPI_ROOT}\\setvars.bat`;

export async function installWin32(target: Target): Promise<string> {
  const version = resolveWindowsVersion(target, SUPPORTED_VERSIONS);

  const release = IFORT_RELEASES.find((r) => r.version === version);
  if (!release) {
    throw new Error(
      `No installer URL found for ifort ${version} on Windows. ` +
        `This is likely a legacy version issue — please check release compatibility.`,
    );
  }

  core.info(`Installing ifort ${version} on Windows (${target.arch})...`);

  // We use a specific cache key for ifort to avoid collisions with ifx
  const cacheKey = `ifort-win32-${target.arch}-${version}`;
  const cachePaths = [ONEAPI_ROOT];

  const cacheHit = await cache.restoreCache(cachePaths, cacheKey);
  if (cacheHit) {
    core.info(`Restored ifort installation from cache (${cacheHit}).`);
  } else {
    core.info(`Downloading ifort installer...`);
    const installerPath = await tc.downloadTool(
      release.url,
      path.join(process.env.RUNNER_TEMP ?? "C:\\Temp", `ifort-${version}.exe`),
    );

    core.info("Running silent install (this may take several minutes)...");
    await exec.exec(`"${installerPath}"`, [
      "-s",
      "-a",
      "--silent",
      "--eula",
      "accept",
      "-p=NEED_VS2019_INTEGRATION=0",
      "-p=NEED_VS2022_INTEGRATION=0",
    ]);

    core.info("Saving installation to cache...");
    await cache.saveCache(cachePaths, cacheKey);
  }

  // Create a temporary batch file to capture the environment variables from setvars.bat
  const batFile = path.join(os.tmpdir(), "setvars_ifort_dump.bat");
  fs.writeFileSync(
    batFile,
    `@echo off\r\ncall "${SETVARS_BAT}" --force\r\nset\r\n`,
  );

  let envOutput = "";
  await exec.exec("cmd", ["/C", batFile], {
    listeners: {
      stdout: (data: Buffer) => {
        envOutput += data.toString();
      },
    },
  });

  for (const line of envOutput.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.substring(0, eqIdx).trim();
    const val = line.substring(eqIdx + 1).trimEnd();

    if (
      /^(PATH|LIB|INCLUDE|.*INTEL.*|.*ONEAPI.*|.*MKL.*|MKLROOT|CMPLR_ROOT)$/i.test(
        key,
      )
    ) {
      core.exportVariable(key, val);
    }
  }

  core.exportVariable("FC", "ifort");
  core.exportVariable("CC", "icl");
  core.exportVariable("CXX", "icl");
  core.exportVariable("FORTRAN_COMPILER", "ifort");
  core.exportVariable("FORTRAN_COMPILER_VERSION", version);

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`ifort ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("ifort", ["/what"], {
    ignoreReturnCode: true,
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
      stderr: (data: Buffer) => {
        output += data.toString();
      },
    },
  });

  // Return the first line of the version output
  return output.trim().split("\r\n")[0] || output.trim();
}
