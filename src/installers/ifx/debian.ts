import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as fs from "fs";
import { Arch, type Target } from "../../types";
import { resolveVersion } from "../../resolve_version";

// The first entry is used as the default when LATEST is requested.
// ARM64 is not supported: Intel oneAPI does not provide Linux ARM64 packages.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: [
    "2026.0",
    "2025.3",
    "2025.2",
    "2025.1",
    "2025.0",
    "2024.2",
    "2024.1",
    "2024.0",
    "2023.2.4",
    "2023.2.3",
    "2023.2.2",
    "2023.2.1",
    "2023.2.0",
    "2023.1.0",
    "2023.0.0",
    "2022.2.1",
    "2022.2.0",
    "2022.1.0",
    "2022.0.2",
    "2022.0.1",
    "2021.4.0",
    "2021.3.0",
    "2021.2.0",
    "2021.1.2",
    "2021.1.1",
  ],
  [Arch.ARM64]: undefined,
} as const satisfies Record<Arch, readonly string[] | undefined>;

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS, {
    resolveMinorToLatestPatch: true,
  });
  core.info(`Installing ifx ${version} on Linux (${target.arch})...`);

  const ONEAPI_ROOT = "/opt/intel/oneapi";
  const cacheKey = `oneapi-ifx-${version}`;
  const cachePaths = [ONEAPI_ROOT];

  if (!fs.existsSync(ONEAPI_ROOT)) {
    fs.mkdirSync(ONEAPI_ROOT, { recursive: true });
  }

  const cacheHit = await cache.restoreCache(cachePaths, cacheKey);

  if (!cacheHit) {
    core.info("Adding Intel oneAPI apt repository...");
    await exec.exec("bash", [
      "-c",
      [
        `wget -O- https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB`,
        `| gpg --dearmor`,
        `| sudo tee /usr/share/keyrings/oneapi-archive-keyring.gpg > /dev/null`,
      ].join(" "),
    ]);
    await exec.exec("bash", [
      "-c",
      `echo "deb [signed-by=/usr/share/keyrings/oneapi-archive-keyring.gpg] https://apt.repos.intel.com/oneapi all main" | sudo tee /etc/apt/sources.list.d/oneAPI.list`,
    ]);

    await exec.exec("sudo", [
      "apt-get",
      "update",
      "-y",
      "-o",
      "Acquire::http::Timeout=60",
      "-o",
      "Acquire::Retries=3",
    ]);

    const fortranPkg = `intel-oneapi-compiler-fortran-${version}`;
    const LEGACY_CPP_PKG_VERSIONS = ["2021", "2022", "2023"];
    const cppPkgBase = LEGACY_CPP_PKG_VERSIONS.some((y) =>
      version.startsWith(y),
    )
      ? "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic"
      : "intel-oneapi-compiler-dpcpp-cpp";
    const cppPkg = `${cppPkgBase}-${version}`;

    core.info(`Installing apt packages ${fortranPkg} and ${cppPkg}...`);
    await exec.exec("sudo", [
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      fortranPkg,
      cppPkg,
    ]);

    await cache.saveCache(cachePaths, cacheKey);
  } else {
    core.info(`Cache hit for ${cacheKey}, skipping installation...`);
  }

  // setvars.sh sourcing always runs — cache hit or miss — because the
  // environment variables are not cached, only the files are.
  const setVarsScript = "/opt/intel/oneapi/setvars.sh";
  core.info(`Sourcing ${setVarsScript} and exporting environment...`);

  let envOutput = "";
  await exec.exec("bash", ["-c", `source "${setVarsScript}" --force && env`], {
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
    // Only export oneAPI/Intel/PATH-related variables.
    if (
      /^(PATH|LD_LIBRARY_PATH|.*INTEL.*|.*ONEAPI.*|.*MKL.*|MKLROOT|CMPLR_ROOT)$/i.test(
        key,
      )
    ) {
      core.exportVariable(key, val);
    }
  }

  core.exportVariable("FC", "ifx");
  core.exportVariable("CC", "icx");
  core.exportVariable("CXX", "icpx");
  core.exportVariable("FPM_FC", "ifx");
  core.exportVariable("FPM_CC", "icx");
  core.exportVariable("FPM_CXX", "icpx");

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`ifx ${resolvedVersion} installed successfully.`);
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
