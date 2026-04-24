import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as tc from "@actions/tool-cache";
import { Arch, WindowsEnv, type Target } from "../../types";
import { resolveWindowsVersion } from "../../resolve_version";

const SUPPORTED_VERSIONS = {
  [Arch.X64]: {
    [WindowsEnv.Native]: ["2024.2", "2024.1", "2024.0", "2023.2", "2023.1", "2023.0"],
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

const ONEAPI_RELEASES: Record<string, string> = {
  "2024.2": "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/b0572b64-07ed-4180-87a2-f6735e29a997/w_fortran-compiler_p_2024.2.1.80_offline.exe",
  "2024.1": "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/1f80f12d-8874-4b55-8d5c-3004313f8d2b/w_fortran-compiler_p_2024.1.0.962_offline.exe",
  "2024.0": "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/da83f360-645c-4a37-b615-58097b6968f2/w_fortran-compiler_p_2024.0.0.49608_offline.exe",
  "2023.2": "https://registrationcenter-download.intel.com/akdlm/irc_nas/19159/w_fortran-compiler_p_2023.2.0.495_offline.exe",
  "2023.1": "https://registrationcenter-download.intel.com/akdlm/irc_nas/19082/w_fortran-compiler_p_2023.1.0.446_offline.exe",
  "2023.0": "https://registrationcenter-download.intel.com/akdlm/irc_nas/19001/w_fortran-compiler_p_2023.0.0.25911_offline.exe",
};

export async function installWin32(target: Target): Promise<string> {
  const version = resolveWindowsVersion(target, SUPPORTED_VERSIONS);
  const downloadUrl = ONEAPI_RELEASES[version];

  if (!downloadUrl) {
    throw new Error(`Unsupported ifort version: ${version}`);
  }

  core.info(`Downloading ifort ${version} from ${downloadUrl}`);
  const downloadPath = await tc.downloadTool(downloadUrl);

  core.info(`Installing ifort ${version}...`);
  // Silent install
  await exec.exec(downloadPath, ["-s", "-a", "--silent", "--eula", "accept"]);

  const oneapiRoot = "C:\\Program Files (x86)\\Intel\\oneAPI";
  const setvarsBat = path.join(oneapiRoot, "setvars.bat");

  core.info(`Sourcing ${setvarsBat} and exporting environment...`);

  let envOutput = "";
  // In Windows, we use cmd to run setvars.bat and then print the environment
  await exec.exec("cmd", ["/c", `"${setvarsBat}" && set`], {
    listeners: {
      stdout: (data: Buffer) => {
        envOutput += data.toString();
      },
    },
  });

  for (const line of envOutput.split("\r\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.substring(0, eqIdx);
    const val = line.substring(eqIdx + 1);
    // Export variables that oneAPI sets
    if (/^(PATH|LD_LIBRARY_PATH|.*INTEL.*|.*ONEAPI.*|.*TBB.*|.*MKL.*|.*CMPLR.*)$/i.test(key)) {
      core.exportVariable(key, val);
    }
  }

  core.exportVariable("FC", "ifort");
  core.exportVariable("F77", "ifort");
  core.exportVariable("F90", "ifort");

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`ifort ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("ifort", ["/version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
