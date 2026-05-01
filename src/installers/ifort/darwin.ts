import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as tc from "@actions/tool-cache";
import { Arch, type Target } from "../../types";
import { resolveVersion } from "../../resolve_version";
import * as fs from "fs";
import path from "path";

// Intel dropped ifort support starting with the 2024 oneAPI release.
// NOTE: Intel's macOS download GUIDs change frequently. These are the standard
// known releases, but if you hit a 403, the GUID in the URL needs updating.
const IFORT_RELEASES = [
  {
    version: "2023.2.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/b0f5cd3e-4dce-4122-aa59-dcfb87b74f32/m_HPCKit_p_2023.2.0.49443_offline.dmg",
  },
  {
    version: "2023.1.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/1fba0fc3-1090-4886-8b01-5221972b9a7c/m_HPCKit_p_2023.1.0.46346_offline.dmg",
  },
  {
    version: "2022.3.0",
    url: "https://registrationcenter-download.intel.com/akdlm/irc_nas/18861/m_HPCKit_p_2022.3.0.8751_offline.dmg",
  },
  {
    version: "2022.2.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18683/m_HPCKit_p_2022.2.0.158_offline.dmg",
  },
  {
    version: "2022.1.0",
    url: "https://registrationcenter-download.intel.com/akdlm/IRC_NAS/18485/m_HPCKit_p_2022.1.0.84_offline.dmg",
  },
  {
    version: "2021.4.0",
    url: "https://registrationcenter-download.intel.com/akdlm/irc_nas/18233/m_HPCKit_p_2021.4.0.3385_offline.dmg",
  },
] as const;

const SUPPORTED_VERSIONS = {
  [Arch.X64]: IFORT_RELEASES.map((r) => r.version),
  [Arch.ARM64]: undefined, // GitHub's macos-14+ runners are ARM64 and cannot run ifort
} as const satisfies Record<Arch, readonly string[] | undefined>;

const ONEAPI_ROOT = "/opt/intel/oneapi";
const SETVARS_SH = `${ONEAPI_ROOT}/setvars.sh`;

export async function installDarwin(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);

  const release = IFORT_RELEASES.find((r) => r.version === version);
  if (!release) {
    throw new Error(`No installer URL found for ifort ${version} on macOS.`);
  }

  core.info(`Installing ifort ${version} on macOS (${target.arch})...`);

  if (target.arch === Arch.ARM64) {
    throw new Error(
      "Intel Fortran (ifort) does not support Apple Silicon (ARM64). " +
        "Please ensure your workflow uses the 'macos-13' runner.",
    );
  }

  const cacheKey = `ifort-darwin-${target.arch}-${version}`;
  const cachePaths = [ONEAPI_ROOT];

  const cacheHit = await cache.restoreCache(cachePaths, cacheKey);
  if (cacheHit) {
    core.info(`Restored ifort installation from cache (${cacheHit}).`);
  } else {
    core.info(`Downloading ifort DMG installer...`);
    const dmgPath = await tc.downloadTool(
      release.url,
      path.join(process.env.RUNNER_TEMP ?? "/tmp", `ifort-${version}.dmg`),
    );

    const mountPoint = "/Volumes/Intel_oneAPI_Installer";

    try {
      core.info("Mounting DMG...");
      await exec.exec("hdiutil", [
        "attach",
        dmgPath,
        "-mountpoint",
        mountPoint,
        "-quiet",
        "-nobrowse",
      ]);

      // Intel's silent installer script moves around depending on the release year.
      // We search for the standard locations.
      let installScript = path.join(mountPoint, "install.sh");
      if (!fs.existsSync(installScript)) {
        installScript = path.join(
          mountPoint,
          "bootstrapper.app",
          "Contents",
          "MacOS",
          "install.sh",
        );
      }
      if (!fs.existsSync(installScript)) {
        installScript = path.join(
          mountPoint,
          "bootstrapper.app",
          "Contents",
          "MacOS",
          "bootstrapper",
        );
      }

      core.info(`Running silent install via ${installScript}...`);
      await exec.exec("sudo", [installScript, "--silent", "--eula", "accept"]);

      core.info("Saving installation to cache...");
      await cache.saveCache(cachePaths, cacheKey);
    } finally {
      // Always ensure the DMG is unmounted, even if the installation fails
      core.info("Unmounting DMG...");
      await exec.exec("hdiutil", ["detach", mountPoint, "-force"]);
    }
  }

  core.info(`Sourcing ${SETVARS_SH} and exporting environment...`);

  let envOutput = "";
  await exec.exec("bash", ["-c", `source "${SETVARS_SH}" --force && env`], {
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

    if (
      /^(PATH|DYLD_LIBRARY_PATH|.*INTEL.*|.*ONEAPI.*|.*MKL.*|MKLROOT|CMPLR_ROOT)$/i.test(
        key,
      )
    ) {
      core.exportVariable(key, val);
    }
  }

  core.exportVariable("FC", "ifort");
  core.exportVariable("CC", "icc");
  core.exportVariable("CXX", "icpc");
  core.exportVariable("FORTRAN_COMPILER", "ifort");
  core.exportVariable("FORTRAN_COMPILER_VERSION", version);

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
  // Return the first line which contains the version string
  return output.trim().split("\n")[0];
}
