import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as tc from "@actions/tool-cache";
import { Arch, type Target } from "../../types";
import { resolveVersion } from "../../resolve_version";

const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["2023.2", "2023.1", "2023.0"],
  [Arch.ARM64]: undefined, // ifort does not support ARM64 on macOS
} as const satisfies Record<Arch, readonly string[] | undefined>;

const ONEAPI_RELEASES: Record<string, string> = {
  "2023.2": "https://registrationcenter-download.intel.com/akdlm/irc_nas/19163/m_fortran-compiler_p_2023.2.0.495.dmg",
  "2023.1": "https://registrationcenter-download.intel.com/akdlm/irc_nas/19086/m_fortran-compiler_p_2023.1.0.446.dmg",
  "2023.0": "https://registrationcenter-download.intel.com/akdlm/irc_nas/19005/m_fortran-compiler_p_2023.0.0.25911.dmg",
};

export async function installDarwin(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  const downloadUrl = ONEAPI_RELEASES[version];

  if (!downloadUrl) {
    throw new Error(`Unsupported ifort version: ${version}`);
  }

  core.info(`Downloading ifort ${version} from ${downloadUrl}`);
  const downloadPath = await tc.downloadTool(downloadUrl);

  core.info(`Mounting DMG...`);
  await exec.exec("hdiutil", ["attach", downloadPath, "-mountpoint", "/Volumes/ifort"]);

  core.info(`Installing ifort ${version}...`);
  // Find the .app or installer inside the DMG
  // Usually it's something like /Volumes/ifort/bootstrapper.app/Contents/MacOS/bootstrapper
  await exec.exec("sudo", [
    "/Volumes/ifort/bootstrapper.app/Contents/MacOS/bootstrapper",
    "--silent",
    "--eula",
    "accept",
  ]);

  core.info(`Unmounting DMG...`);
  await exec.exec("hdiutil", ["detach", "/Volumes/ifort"]);

  const setvarsPath = "/opt/intel/oneapi/setvars.sh";
  core.info(`Sourcing ${setvarsPath} and exporting environment...`);

  let envOutput = "";
  await exec.exec("bash", ["-c", `source "${setvarsPath}" && env`], {
    listeners: {
      stdout: (data: Buffer) => {
        envOutput += data.toString();
      },
    },
  });

  for (const line of envOutput.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.substring(0, eqIdx);
    const val = line.substring(eqIdx + 1);
    if (/^(PATH|LD_LIBRARY_PATH|DYLD_LIBRARY_PATH|.*INTEL.*|.*ONEAPI.*|.*TBB.*|.*MKL.*|.*CMPLR.*)$/i.test(key)) {
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
  await exec.exec("ifort", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
