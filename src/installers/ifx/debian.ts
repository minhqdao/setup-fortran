import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: [
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
  ],
  [Arch.ARM64]: undefined, // IFX does not support ARM64
} as const satisfies Record<Arch, readonly string[] | undefined>;

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  core.info(`Installing IFX ${version} on Linux (${target.arch})...`);

  // Setup Intel repository
  // https://www.intel.com/content/www/us/en/docs/oneapi/installation-guide-linux/current/apt.html
  await exec.exec("bash", [
    "-c",
    "wget -O- https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB | gpg --dearmor | sudo tee /usr/share/keyrings/oneapi-archive-keyring.gpg > /dev/null",
  ]);
  await exec.exec("bash", [
    "-c",
    'echo "deb [signed-by=/usr/share/keyrings/oneapi-archive-keyring.gpg] https://apt.repos.intel.com/oneapi all main" | sudo tee /etc/apt/sources.list.d/oneAPI.list',
  ]);

  await exec.exec("sudo", ["apt-get", "update", "-y"]);

  const pkgName = `intel-oneapi-compiler-fortran-${version}`;

  core.info(`Installing package ${pkgName}...`);
  await exec.exec("sudo", [
    "apt-get",
    "install",
    "-y",
    "--no-install-recommends",
    pkgName,
  ]);

  // Source setvars.sh and export environment variables
  const setvarsPath = "/opt/intel/oneapi/setvars.sh";
  core.info(`Sourcing ${setvarsPath} and exporting environment...`);

  let envOutput = "";
  // We use "bash -c 'source ... && env'" to get the environment after sourcing
  await exec.exec("bash", ["-c", `source "${setvarsPath}" && env`], {
    listeners: {
      stdout: (data: Buffer) => {
        envOutput += data.toString();
      },
    },
  });

  const lines = envOutput.split("\n");
  for (const line of lines) {
    const parts = line.split("=");
    if (parts.length >= 2) {
      const key = parts[0];
      const value = parts.slice(1).join("=");
      // Export relevant variables: PATH, LD_LIBRARY_PATH, and anything starting with INTEL or ONEAPI
      if (
        key === "PATH" ||
        key === "LD_LIBRARY_PATH" ||
        key.startsWith("INTEL") ||
        key.startsWith("ONEAPI")
      ) {
        if (key === "PATH") {
          // Add new entries to path
          const newPaths = value.split(":");
          const oldPaths = (process.env.PATH || "").split(":");
          for (const p of newPaths) {
            if (p && !oldPaths.includes(p)) {
              core.addPath(p);
            }
          }
        } else {
          core.exportVariable(key, value);
        }
      }
    }
  }

  core.exportVariable("FC", "ifx");
  core.exportVariable("CC", "icx");
  core.exportVariable("CXX", "icpx");

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`IFX ${resolvedVersion} installed successfully.`);
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
