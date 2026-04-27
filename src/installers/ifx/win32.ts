import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { Arch, LATEST, type Target } from "../../types";
import { resolveVersion } from "../../resolve_version";

// Only LATEST is supported via winget — specific versions require offline
// installers with per-version URLs, which will be added in a follow-up.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: [LATEST] as const,
  [Arch.ARM64]: undefined,
} as const satisfies Record<Arch, readonly string[] | undefined>;

const ONEAPI_ROOT = "C:\\Program Files (x86)\\Intel\\oneAPI";
const SETVARS_BAT = `${ONEAPI_ROOT}\\setvars.bat`;

export async function installWin32(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);

  core.info(`Installing ifx (${version}) on Windows (${target.arch})...`);

  const cacheKey = `ifx-winget-${target.arch}-${version}`;
  const cachePaths = [ONEAPI_ROOT];

  const cacheHit = await cache.restoreCache(cachePaths, cacheKey);
  if (cacheHit) {
    core.info(`Restored ifx installation from cache (${cacheHit}).`);
  } else {
    core.info("Cache miss — installing via winget...");
    await exec.exec("winget", [
      "install",
      "--id",
      "Intel.OneAPI.HPCToolkit",
      "--accept-source-agreements",
      "--accept-package-agreements",
      "--silent",
    ]);
    core.info("Saving installation to cache...");
    await cache.saveCache(cachePaths, cacheKey);
  }

  // Source setvars.bat and propagate the relevant environment variables.
  core.info(`Sourcing ${SETVARS_BAT} and exporting environment...`);
  let envOutput = "";
  await exec.exec("cmd", ["/C", `call "${SETVARS_BAT}" --force && set`], {
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
    if (/^(PATH|.*INTEL.*|.*ONEAPI.*|.*MKL.*|MKLROOT|CMPLR_ROOT)$/i.test(key)) {
      core.exportVariable(key, val);
    }
  }

  core.exportVariable("FC", "ifx");
  core.exportVariable("CC", "icx");
  core.exportVariable("CXX", "icpx");
  core.exportVariable("FORTRAN_COMPILER", "ifx");

  const resolvedVersion = await resolveInstalledVersion();
  core.exportVariable("FORTRAN_COMPILER_VERSION", resolvedVersion);
  core.info(`ifx ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("ifx.exe", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
