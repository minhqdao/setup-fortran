import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import * as path from "path";
import * as fs from "fs";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["5.1", "5.0", "4.2", "4.1", "4.0", "3.2"],
  [Arch.ARM64]: undefined,
} as const satisfies Record<Arch, readonly string[] | undefined>;

interface AoccRelease {
  deb: string;
  url: string;
  sha256: string;
  installDir: string;
}

const AOCC_RELEASES: Record<string, AoccRelease> = {
  "5.1": {
    deb: "aocc-compiler-5.1.0_1_amd64.deb",
    url: "https://download.amd.com/developer/eula/aocc/aocc-5-1/aocc-compiler-5.1.0_1_amd64.deb",
    sha256: "42f9ed0713a8fe269d5a5b40b1992a5380ff59b4441e58d38eb9f27df5bfe6df",
    installDir: "/opt/AMD/aocc-compiler-5.1.0",
  },
  "5.0": {
    deb: "aocc-compiler-5.0.0_1_amd64.deb",
    url: "https://download.amd.com/developer/eula/aocc/aocc-5-0/aocc-compiler-5.0.0_1_amd64.deb",
    sha256: "b937b3f19f59ac901a2c3466a80988e0545d53827900eaa5b3c1ad0cd9fdf0c8",
    installDir: "/opt/AMD/aocc-compiler-5.0.0",
  },
  "4.2": {
    deb: "aocc-compiler-4.2.0_1_amd64.deb",
    url: "https://download.amd.com/developer/eula/aocc/aocc-4-2/aocc-compiler-4.2.0_1_amd64.deb",
    sha256: "4c259e959fecd6408157681f81407f3c43572cfd9ad6353ccec570cf7f732db3",
    installDir: "/opt/AMD/aocc-compiler-4.2.0",
  },
  "4.1": {
    deb: "aocc-compiler-4.1.0_1_amd64.deb",
    url: "https://download.amd.com/developer/eula/aocc/aocc-4-1/aocc-compiler-4.1.0_1_amd64.deb",
    sha256: "013ecc70ba7d6a2fb434dc686def95b7f87a41a091cecebc890a5fd68ad83a3e",
    installDir: "/opt/AMD/aocc-compiler-4.1.0",
  },
  "4.0": {
    deb: "aocc-compiler-4.0.0_1_amd64.deb",
    url: "https://download.amd.com/developer/eula/aocc/aocc-4-0/aocc-compiler-4.0.0_1_amd64.deb",
    sha256: "3433e6f3da48e481a4ae00e4f8c990a429492f2d1ab8e5df8e35cd91aae44291",
    installDir: "/opt/AMD/aocc-compiler-4.0.0",
  },
  "3.2": {
    deb: "aocc-compiler-3.2.0_1_amd64.deb",
    url: "https://download.amd.com/developer/eula/aocc/aocc-3-2/aocc-compiler-3.2.0_1_amd64.deb",
    sha256: "98ef7f3007fa40105f2a7fdb94e7f5869495c353f3ec558c32442d9b83f75201",
    installDir: "/opt/AMD/aocc-compiler-3.2.0",
  },
};

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  const release = AOCC_RELEASES[version];

  core.info(`Installing AOCC ${version} on Linux (${target.arch})...`);

  if (!fs.existsSync(release.installDir)) {
    core.info(`Downloading AOCC ${version} from ${release.url}...`);
    const debPath = await tc.downloadTool(release.url);

    core.info(`Verifying checksum...`);
    await exec.exec("bash", [
      "-c",
      `echo "${release.sha256}  ${debPath}" | sha256sum -c -`,
    ]);

    core.info(`Installing AOCC ${version}...`);
    await exec.exec("sudo", ["apt-get", "install", "-y", debPath]);
  } else {
    core.info(
      `AOCC ${version} already installed at ${release.installDir}, skipping download.`,
    );
  }

  // Source setenv_AOCC.sh and propagate the variables it sets to GITHUB_ENV
  // so subsequent steps can use the AOCC environment.
  const setenvScript = path.join(release.installDir, "setenv_AOCC.sh");
  core.info(`Sourcing ${setenvScript} and exporting environment...`);

  let envOutput = "";
  await exec.exec("bash", ["-c", `source "${setenvScript}" && env`], {
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
    // Only export AOCC/AMD/PATH-related variables
    if (/^(PATH|LD_LIBRARY_PATH|.*AOCC.*|.*AMD.*)$/i.test(key)) {
      core.exportVariable(key, val);
    }
  }

  const binDir = path.join(release.installDir, "bin");
  core.addPath(binDir);
  core.exportVariable("FC", "flang");
  core.exportVariable("CC", "clang");
  core.exportVariable("CXX", "clang++");

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`AOCC flang ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  await exec.exec("flang", ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
