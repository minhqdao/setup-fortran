import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["2024.2", "2024.1", "2024.0", "2023.2", "2023.1", "2023.0"],
  [Arch.ARM64]: undefined,
} as const satisfies Record<Arch, readonly string[] | undefined>;

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  core.info(`Installing ifort ${version} on Linux (${target.arch})...`);

  // Add the Intel oneAPI apt repository
  core.info("Adding Intel oneAPI apt repository...");
  await exec.exec("bash", [
    "-c",
    "curl -fsSL https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB | sudo gpg --dearmor -o /usr/share/keyrings/oneapi-archive-keyring.gpg",
  ]);
  await exec.exec("bash", [
    "-c",
    'echo "deb [signed-by=/usr/share/keyrings/oneapi-archive-keyring.gpg] https://apt.repos.intel.com/oneapi all main" | sudo tee /etc/apt/sources.list.d/oneAPI.list',
  ]);

  await exec.exec("sudo", ["apt-get", "update", "-y"]);

  // ifort is in intel-oneapi-compiler-fortran (recent versions)
  // or intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic
  const pkgName = `intel-oneapi-compiler-fortran-${version}`;

  core.info(`Installing apt package ${pkgName}...`);
  await exec.exec("sudo", [
    "apt-get",
    "install",
    "-y",
    "--no-install-recommends",
    pkgName,
    "intel-oneapi-common-vars",
  ]);

  const setvarsPath = "/opt/intel/oneapi/setvars.sh";
  core.info(`Sourcing ${setvarsPath} and exporting environment...`);

  let envOutput = "";
  // We specify the version to setvars if possible, or just let it do its thing.
  // For ifort, we want to make sure it's in the path.
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
    // Export variables that oneAPI sets
    if (
      /^(PATH|LD_LIBRARY_PATH|.*INTEL.*|.*ONEAPI.*|.*TBB.*|.*MKL.*|.*CMPLR.*)$/i.test(
        key,
      )
    ) {
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
