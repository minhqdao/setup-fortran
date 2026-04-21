import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["15", "14", "13", "12", "11"],
  [Arch.ARM64]: ["15", "14", "13", "12", "11"],
} as const satisfies Record<Arch, readonly string[]>;

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  core.info(`Installing GCC ${version} on Linux (${target.arch})...`);

  await exec.exec("sudo", [
    "add-apt-repository",
    "--yes",
    "ppa:ubuntu-toolchain-r/test",
  ]);
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

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`GCC ${resolvedVersion} installed successfully.`);
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
  const match = /\d+\.\d+\.\d+/.exec(output);
  if (!match)
    throw new Error(`Could not parse gfortran version from: ${output}`);
  return match[0];
}
