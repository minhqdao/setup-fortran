import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["16", "15", "14", "13", "12", "11"],
  [Arch.ARM64]: ["16", "15", "14", "13", "12", "11"],
} as const satisfies Record<Arch, readonly string[]>;

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  core.info(`Installing GFortran ${version} on Linux (${target.arch})...`);

  if (version === "15" || target.osVersion.includes("22")) {
    await exec.exec("sudo", [
      "add-apt-repository",
      "--yes",
      "ppa:ubuntu-toolchain-r/test",
    ]);
  }

  await exec.exec("sudo", ["apt-get", "update", "-y"]);
  await exec.exec("sudo", [
    "apt-get",
    "install",
    "-y",
    `gcc-${version}`,
    `gfortran-${version}`,
  ]);

  await exec.exec("sudo", [
    "update-alternatives",
    "--install",
    "/usr/bin/gcc",
    "gcc",
    `/usr/bin/gcc-${version}`,
    "100",
    "--slave",
    "/usr/bin/gfortran",
    "gfortran",
    `/usr/bin/gfortran-${version}`,
  ]);

  core.info(`Setting FC, F77, and F90 environment variables...`);
  core.exportVariable("FC", `gfortran-${version}`);
  core.exportVariable("F77", `gfortran-${version}`);
  core.exportVariable("F90", `gfortran-${version}`);

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`GFortran ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("gfortran", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
