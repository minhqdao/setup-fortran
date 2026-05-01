import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as tc from "@actions/tool-cache";
import { Arch, OS, type Target } from "../../types";
import { resolveVersion } from "../../resolve_version";
import * as fs from "fs";
import * as os from "os";
import path from "path";

// Only versions with a known installer URL are listed. LATEST resolves to the
// first entry. ARM64 is not supported: Intel oneAPI does not provide Windows
// ARM64 packages.
//
// LATEST will resolve to the first list entry.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: [
    "2026.0.0",
    "2025.3.3",
    "2025.3.2",
    "2025.3.1",
    "2025.3.0",
    "2025.2.1",
    "2025.2.0",
    "2025.1.0",
    "2025.0.4",
    "2025.0.3",
    "2025.0.1",
    "2025.0.0",
    "2024.2.1",
    "2024.2.0",
    "2024.1.0",
    "2024.0.2",
    "2023.2.1",
    "2022.3.1",
    "2021.4.0",
    "2021.3.0",
    "2021.2.0",
    "2021.1.0",
  ],
  [Arch.ARM64]: undefined,
} as const satisfies Record<Arch, readonly string[] | undefined>;

// Maps each full patch version to its Windows offline installer URL.
// URLs contain opaque UUIDs and cannot be derived programmatically —
// they must be maintained manually. The latest patch for each YYYY.MINOR
// base is listed first; earlier patches are kept for reference.
//
// Sources:
//   https://www.wingetgui.com/apps/Intel-FortranCompiler
//   https://github.com/equipez/github_actions_scripts/blob/main/install_oneapi_windows.bat
const INSTALLER_URLS: Record<string, string> = {
  // 2026.0
  "2026.0.0":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/9af38d13-867b-45af-a950-0b42d9bac1ae/intel-fortran-compiler-2026.0.0.566_offline.exe",
  // 2025.3
  "2025.3.3":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/11a7fdc4-e14d-42b0-a48b-9a4777932c31/intel-fortran-compiler-2025.3.3.16_offline.exe",
  "2025.3.2":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/039121f2-d488-4bc1-a5bb-97528e3a4b86/intel-fortran-compiler-2025.3.2.26_offline.exe",
  "2025.3.1":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/79e069e4-f844-43df-8d73-3674c024b043/intel-fortran-compiler-2025.3.1.15_offline.exe",
  "2025.3.0":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/cb54db79-1d73-4443-8274-d712fdc2d156/intel-fortran-compiler-2025.3.0.324_offline.exe",
  // 2025.2
  "2025.2.1":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/0dc56e76-d2c0-4bb8-9c83-c2ee3952b855/intel-fortran-compiler-2025.2.1.11_offline.exe",
  "2025.2.0":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/d500a63b-e481-465d-b1a3-64a6981d25f1/intel-fortran-compiler-2025.2.0.535_offline.exe",
  // 2025.1
  "2025.1.0":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/9962ffec-17a2-4135-94e5-acc3995e0c49/intel-fortran-compiler-2025.1.0.602_offline.exe",
  // 2025.0
  "2025.0.4":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/1269b58a-590e-49b1-9f53-beebe171ac56/intel-fortran-compiler-2025.0.4.19_offline.exe",
  "2025.0.3":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/ead426f0-5403-412f-9652-106156965748/intel-fortran-compiler-2025.0.3.11_offline.exe",
  "2025.0.1":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/fc495846-44b3-4a47-a2a5-17b404dc207a/intel-fortran-compiler-2025.0.1.40_offline.exe",
  "2025.0.0":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/90dfd1ee-cbde-4461-89fc-3d4a4587844c/intel-fortran-compiler-2025.0.0.712_offline.exe",
  // 2024.2
  "2024.2.2":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/89a381f6-f85d-4dda-ae62-30d51470f53c/l_onemkl_p_2024.2.2.17_offline.exe",
  "2024.2.1":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/6e00e368-b61d-4f87-a409-9b510c022a37/l_onemkl_p_2024.2.1.105_offline.exe",
  // "2024.2.1":
  //   "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/ea23d696-a77f-4a4a-8996-20d02cdbc48f/w_fortran-compiler_p_2024.2.1.81_offline.exe",
  "2024.2.0":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/7feb5647-59dd-420d-8753-345d31e177dc/w_fortran-compiler_p_2024.2.0.424_offline.exe",
  // 2024.1
  "2024.1.0":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/f6a44238-5cb6-4787-be83-2ef48bc70cba/w_fortran-compiler_p_2024.1.0.466_offline.exe",
  // 2024.0
  "2024.0.2":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/3a64aab4-3c35-40ba-bc9c-f80f136a8005/w_fortran-compiler_p_2024.0.2.27_offline.exe",
  // 2023.2
  "2023.2.1":
    "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/1720594b-b12c-4aca-b7fb-a7d317bac5cb/w_fortran-compiler_p_2023.2.1.7_offline.exe",
  // 2022
  "2022.3.1":
    "https://registrationcenter-download.intel.com/akdlm/irc_nas/18976/w_HPCKit_p_2022.3.1.19755_offline.exe",
  // 2021
  "2021.4.0":
    "https://registrationcenter-download.intel.com/akdlm/irc_nas/18247/w_HPCKit_p_2021.4.0.3340_offline.exe",
  "2021.3.0":
    "https://registrationcenter-download.intel.com/akdlm/irc_nas/17940/w_HPCKit_p_2021.3.0.3227_offline.exe",
  "2021.2.0":
    "https://registrationcenter-download.intel.com/akdlm/irc_nas/17762/w_HPCKit_p_2021.2.0.2901_offline.exe",
  "2021.1.0":
    "https://registrationcenter-download.intel.com/akdlm/irc_nas/17392/w_HPCKit_p_2021.1.0.2682_offline.exe",
};

const ONEAPI_ROOT = "C:\\Program Files (x86)\\Intel\\oneAPI";
const SETVARS_BAT = `${ONEAPI_ROOT}\\setvars.bat`;

export async function installWin32(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);

  const installerUrl = INSTALLER_URLS[version];
  if (!installerUrl) {
    throw new Error(
      `No installer URL found for ifx ${version} on Windows. ` +
        `This is a bug — please open an issue.`,
    );
  }

  core.info(`Installing ifx ${version} on Windows (${target.arch})...`);

  const cacheKey = `ifx-win32-${target.arch}-${version}`;
  const cachePaths = [ONEAPI_ROOT];

  const cacheHit = await cache.restoreCache(cachePaths, cacheKey);
  if (cacheHit) {
    core.info(`Restored ifx installation from cache (${cacheHit}).`);
  } else {
    core.info(`Downloading installer...`);
    const installerPath = await tc.downloadTool(
      installerUrl,
      path.join(process.env.RUNNER_TEMP ?? "C:\\Temp", `ifx-${version}.exe`),
    );

    core.info("Running silent install...");
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

  const batFile = path.join(os.tmpdir(), "setvars_and_dump.bat");
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
      /^(PATH|LIB|.*INTEL.*|.*ONEAPI.*|.*MKL.*|MKLROOT|CMPLR_ROOT)$/i.test(key)
    ) {
      core.exportVariable(key, val);
    }
  }

  core.exportVariable("FC", "ifx");
  core.exportVariable("CC", "icx");
  core.exportVariable("CXX", "icpx");
  core.exportVariable("FORTRAN_COMPILER", "ifx");
  core.exportVariable("FORTRAN_COMPILER_VERSION", version);

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`ifx ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(): Promise<string> {
  const versionCommand =
    process.platform === OS.Windows ? "/what" : "--version";

  let output = "";
  await exec.exec("ifx", [versionCommand], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
      stderr: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
