import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as cache from "@actions/cache";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure that the "latest" version is listed first. If the user does not
// specify a version, the latest will be installed by default.
const AOCC_RELEASES = [
  {
    version: "5.1",
    sha256: "42f9ed0713a8fe269d5a5b40b1992a5380ff59b4441e58d38eb9f27df5bfe6df",
  },
  {
    version: "5.0",
    sha256: "b937b3f19f59ac901a2c3466a80988e0545d53827900eaa5b3c1ad0cd9fdf0c8",
  },
  {
    version: "4.2",
    sha256: "4c259e959fecd6408157681f81407f3c43572cfd9ad6353ccec570cf7f732db3",
  },
  {
    version: "4.1",
    sha256: "013ecc70ba7d6a2fb434dc686def95b7f87a41a091cecebc890a5fd68ad83a3e",
  },
] as const;

const SUPPORTED_VERSIONS = {
  [Arch.X64]: AOCC_RELEASES.map((r) => r.version),
  [Arch.ARM64]: undefined,
} as const satisfies Record<Arch, readonly string[] | undefined>;

interface AoccMetadata {
  deb: string;
  sha256: string;
  url: string;
  installDir: string;
}

function getReleaseMetadata(version: string): AoccMetadata {
  const release = AOCC_RELEASES.find((r) => r.version === version);

  if (!release) {
    throw new Error(`AOCC version ${version} is not defined in AOCC_RELEASES.`);
  }

  const fullVersion = `${version}.0`; // e.g., "5.1" -> "5.1.0"
  const urlVersion = version.replace(".", "-"); // e.g., "5.1" -> "5-1"
  const deb = `aocc-compiler-${fullVersion}_1_amd64.deb`;

  return {
    deb,
    sha256: release.sha256,
    url: `https://download.amd.com/developer/eula/aocc/aocc-${urlVersion}/${deb}`,
    installDir: `/opt/AMD/aocc-compiler-${fullVersion}`,
  };
}

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  const metadata = getReleaseMetadata(version);

  core.info(`Installing AOCC ${version} on Linux (${target.arch})...`);

  const cacheKey = `aocc-${version}-${target.arch}-${target.osVersion}`;
  const tempInstallDir = path.join(os.homedir(), ".aocc-cache");
  const cacheHit = await cache.restoreCache([tempInstallDir], cacheKey);

  if (cacheHit) {
    core.info("Restored from cache, moving to /opt...");
    await exec.exec("sudo", ["mkdir", "-p", "/opt/AMD"]);
    await exec.exec("sudo", ["mv", tempInstallDir, metadata.installDir]);
  } else if (!fs.existsSync(metadata.installDir)) {
    const debPath = path.join(os.tmpdir(), metadata.deb);

    core.info(`Downloading AOCC ${version} from ${metadata.url}...`);
    await exec.exec("curl", [
      "-fSL",
      "--retry",
      "3",
      "--retry-delay",
      "15",
      "--user-agent",
      "Mozilla/5.0",
      "-o",
      debPath,
      metadata.url,
    ]);

    core.info(`Verifying checksum...`);
    await exec.exec("bash", [
      "-c",
      `echo "${metadata.sha256}  ${debPath}" | sha256sum -c -`,
    ]);

    core.info(`Installing AOCC ${version}...`);
    await exec.exec("sudo", ["dpkg", "-i", debPath]);
    await exec.exec("sudo", ["apt-get", "install", "-f", "-y"]);

    core.info(`Saving AOCC ${version} to cache...`);
    await exec.exec("sudo", ["cp", "-r", metadata.installDir, tempInstallDir]);
    await exec.exec("sudo", [
      "chown",
      "-R",
      os.userInfo().username,
      tempInstallDir,
    ]);
    await cache.saveCache([tempInstallDir], cacheKey);
  } else {
    core.info(
      `AOCC ${version} already installed at ${metadata.installDir}, skipping download.`,
    );
  }

  const setenvScript = path.join(metadata.installDir, "setenv_AOCC.sh");
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
    if (/^(PATH|LD_LIBRARY_PATH|.*AOCC.*|.*AMD.*)$/i.test(key)) {
      core.exportVariable(key, val);
    }
  }

  core.addPath(path.join(metadata.installDir, "bin"));
  core.exportVariable("FC", "flang");
  core.exportVariable("CC", "clang");
  core.exportVariable("CXX", "clang++");
  core.exportVariable("FPM_FC", "flang");
  core.exportVariable("FPM_CC", "clang");
  core.exportVariable("FPM_CXX", "clang++");

  return await resolveInstalledVersion();
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
