import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// Intel ifx versions follow a YY.minor[.patch] scheme (e.g. "2025.1.0").
// Both "2025.1" and "2025.1.0" are valid inputs and matched exactly against
// this list — no major-stripping is applied for Intel versions.
// ARM64 is not supported: Intel oneAPI does not provide Linux ARM64 packages.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: [
    "2026.0",
    "2026.0.0",
    "2025.3",
    "2025.3.2",
    "2025.3.1",
    "2025.3.0",
    "2025.2",
    "2025.2.1",
    "2025.2.0",
    "2025.1",
    "2025.1.1",
    "2025.0",
    "2025.0.1",
    "2025.0.0",
    "2024.2",
    "2024.2.0",
    "2024.1",
    "2024.1.0",
    "2024.0",
    "2024.0.3",
    "2024.0.2",
    "2024.0.1",
    "2024.0.0",
    "2023.2",
    "2023.2.4",
    "2023.2.3",
    "2023.2.2",
    "2023.2.1",
    "2023.2.0",
    "2023.1",
    "2023.1.0",
    "2023.0",
    "2023.0.0",
    "2022.2",
    "2022.2.1",
    "2022.2.0",
    "2022.1",
    "2022.1.0",
    "2022.0",
    "2022.0.0",
    "2021.4",
    "2021.4.0",
    "2021.3",
    "2021.3.0",
    "2021.2",
    "2021.2.0",
    "2021.1",
    "2021.1.2",
    "2021.1.1",
    "2021.1.0",
  ],
  [Arch.ARM64]: undefined,
} as const satisfies Record<Arch, readonly string[] | undefined>;

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  const pkgVersion = mapVersion(version);

  core.info(`Installing ifx ${version} on Linux (${target.arch})...`);

  // Add the Intel oneAPI apt repository if not already present.
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

  await exec.exec("sudo", ["apt-get", "update", "-y"]);

  // The versioned package names follow the intel-oneapi-compiler-<component>-<version> scheme.
  // We install both the Fortran and C++ compilers to provide ifx, icx, and icpx.
  const fortranPkg = `intel-oneapi-compiler-fortran-${pkgVersion}`;
  const cppPkgBase =
    pkgVersion.startsWith("2024") ||
    pkgVersion.startsWith("2025") ||
    pkgVersion.startsWith("2026")
      ? "intel-oneapi-compiler-dpcpp-cpp"
      : "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic";
  const cppPkg = `${cppPkgBase}-${pkgVersion}`;

  core.info(`Installing apt packages ${fortranPkg} and ${cppPkg}...`);
  await exec.exec("sudo", [
    "apt-get",
    "install",
    "-y",
    "--no-install-recommends",
    fortranPkg,
    cppPkg,
  ]);

  // Source setvars.sh and propagate the relevant environment variables so
  // subsequent steps have a correctly configured oneAPI environment.
  // The setvars.sh location follows the Unified Directory Layout (2024.0+).
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
  core.exportVariable("FORTRAN_COMPILER", "ifx");
  core.exportVariable("FORTRAN_COMPILER_VERSION", version);

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

/**
 * Maps a user-provided version string to the specific version suffix used in
 * the Intel oneAPI apt repository package names.
 */
function mapVersion(version: string): string {
  const mapping: Record<string, string> = {
    "2026.0": "2026.0",
    "2026.0.0": "2026.0",
    "2025.3": "2025.3",
    "2025.3.2": "2025.3",
    "2025.3.1": "2025.3",
    "2025.3.0": "2025.3",
    "2025.2": "2025.2",
    "2025.2.1": "2025.2",
    "2025.2.0": "2025.2",
    "2025.1": "2025.1",
    "2025.1.1": "2025.1",
    "2025.0": "2025.0",
    "2025.0.1": "2025.0",
    "2025.0.0": "2025.0",
    "2024.2": "2024.2",
    "2024.2.0": "2024.2",
    "2024.1": "2024.1",
    "2024.1.0": "2024.1",
    "2024.0": "2024.0",
    "2024.0.3": "2024.0",
    "2024.0.2": "2024.0",
    "2024.0.1": "2024.0",
    "2024.0.0": "2024.0",
    "2023.2": "2023.2.0",
    "2023.1": "2023.1.0",
    "2023.0": "2023.0.0",
    "2022.2": "2022.3.0",
    "2022.1": "2022.2.0",
    "2021.4": "2021.4.0",
    "2021.3": "2021.3.0",
    "2021.2": "2021.2.0",
    "2021.1": "2021.1.2",
  };
  return mapping[version] || version;
}
