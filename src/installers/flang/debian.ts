import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["20", "19", "18", "17", "16", "15"],
  [Arch.ARM64]: ["20", "19", "18", "17", "16", "15"],
} as const satisfies Record<Arch, readonly string[]>;

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  core.info(`Installing Flang ${version} on Linux (${target.arch})...`);

  await exec.exec("wget", ["-O", "llvm.sh", "https://apt.llvm.org/llvm.sh"]);
  await exec.exec("chmod", ["+x", "llvm.sh"]);
  await exec.exec("sudo", ["./llvm.sh", version]);

  await exec.exec("sudo", ["apt-get", "update", "-y"]);
  await exec.exec("sudo", ["apt-get", "install", "-y", `flang-${version}`]);

  // Symlink flang-new-<version> to flang if flang-<version> doesn't exist
  // Based on apt.llvm.org, the binary is often flang-new-<version>
  const flangBinary = `/usr/bin/flang-${version}`;
  const flangNewBinary = `/usr/bin/flang-new-${version}`;

  await exec
    .exec("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      flangBinary,
      "100",
    ])
    .catch(async () => {
      core.info(`${flangBinary} not found, trying ${flangNewBinary}`);
      await exec.exec("sudo", [
        "update-alternatives",
        "--install",
        "/usr/bin/flang",
        "flang",
        flangNewBinary,
        "100",
      ]);
    });

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`Flang ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("/usr/bin/flang", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
