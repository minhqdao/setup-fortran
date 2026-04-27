import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { Arch, LATEST } from "../../types";
import type { Target } from "../../types";

// A clean list of supported base versions (YYYY.MINOR).
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
  const versions = SUPPORTED_VERSIONS[target.arch];

  if (!versions) {
    throw new Error(
      `No supported versions found for ifx on Linux (${target.arch}).`,
    );
  }

  const version = target.version === LATEST ? versions[0] : target.version;

  if (!(versions as readonly string[]).includes(version)) {
    throw new Error(
      `ifx ${target.version} is not supported on Linux (${target.arch}). ` +
        `Supported versions: ${versions.join(", ")}`,
    );
  }

  // Preserve originally requested version (if available) for better UX in logs
  const displayVersion = target.version === LATEST ? version : target.version;

  core.info(`Installing ifx ${displayVersion} on Linux (${target.arch})...`);

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
  const fortranPkg = `intel-oneapi-compiler-fortran-${version}`;
  const cppPkgBase =
    version.startsWith("2024") ||
    version.startsWith("2025") ||
    version.startsWith("2026")
      ? "intel-oneapi-compiler-dpcpp-cpp"
      : "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic";
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
  core.exportVariable("FORTRAN_COMPILER_VERSION", displayVersion);

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
