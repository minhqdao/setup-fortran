import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { LATEST, type Target } from "../../types";

const SUPPORTED_VERSIONS = ["15", "14", "13", "12", "11"] as const;
type SupportedVersion = (typeof SUPPORTED_VERSIONS)[number];

function validateVersion(target: Target): SupportedVersion {
  const version = target.version;

  if ((SUPPORTED_VERSIONS as readonly string[]).includes(version)) {
    return version as SupportedVersion;
  }

  throw new Error(
    `${target.compiler} ${version} is not supported on ${target.os}. ` +
      `Supported versions: ${SUPPORTED_VERSIONS.join(", ")}`,
  );
}

export async function installLinux(target: Target): Promise<string> {
  const version =
    target.version === LATEST ? SUPPORTED_VERSIONS[0] : validateVersion(target);

  core.info(`Installing GCC ${version} on Linux...`);

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

  // Create unversioned symlinks so `gcc` and `gfortran` resolve to the installed version
  await exec.exec("sudo", [
    "update-alternatives",
    "--install",
    "/usr/bin/gcc",
    "gcc",
    `/usr/bin/gcc-${version}`,
    "100",
  ]);
  await exec.exec("sudo", [
    "update-alternatives",
    "--install",
    "/usr/bin/gfortran",
    "gfortran",
    `/usr/bin/gfortran-${version}`,
    "100",
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
  // Output looks like: "GNU Fortran (Ubuntu 15.1.0-6ubuntu1) 15.1.0"
  const match = /\d+\.\d+\.\d+/.exec(output);
  if (!match)
    throw new Error(`Could not parse gfortran version from: ${output}`);
  return match[0];
}
