import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { Arch, type Target } from "../../types";
import { resolveVersion } from "../../resolve_version";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// Mapping: https://www.intel.com/content/www/us/en/developer/articles/tool/compilers-redistributable-libraries-by-version.html
const IFORT_BUNDLES = [
  { ifort: "2021.13", bundle: "2024.2" },
  { ifort: "2021.12", bundle: "2024.1" },
  { ifort: "2021.11", bundle: "2024.0" },
  { ifort: "2021.10", bundle: "2023.2.4" },
  { ifort: "2021.9", bundle: "2023.1.0" },
  { ifort: "2021.8", bundle: "2023.0.0" },
  { ifort: "2021.7", bundle: "2022.2.0" },
  { ifort: "2021.6", bundle: "2022.1.0" },
  { ifort: "2021.5", bundle: "2022.0.2" },
  { ifort: "2021.4", bundle: "2021.4.0" },
  { ifort: "2021.3", bundle: "2021.3.0" },
  { ifort: "2021.2", bundle: "2021.2.0" },
  { ifort: "2021.1", bundle: "2021.1.2" },
] as const;

const SUPPORTED_VERSIONS = {
  [Arch.X64]: IFORT_BUNDLES.map((m) => m.ifort),
  [Arch.ARM64]: undefined,
} as const satisfies Record<Arch, readonly string[] | undefined>;

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);

  const entry = IFORT_BUNDLES.find((m) => m.ifort === version);
  if (!entry) {
    throw new Error(`Unsupported ifort version: ${version}`);
  }

  const bundle = entry.bundle;

  core.info(`Installing ifort ${version} on Linux (${target.arch})...`);

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
  // Because ifort only exists in <=2023, the C++ package is always the classic variant.
  const fortranPkg = `intel-oneapi-compiler-fortran-${bundle}`;
  const cppPkgBase = bundle.startsWith("2024")
    ? "intel-oneapi-compiler-dpcpp-cpp"
    : "intel-oneapi-compiler-dpcpp-cpp-and-cpp-classic";
  const cppPkg = `${cppPkgBase}-${bundle}`;

  core.info(`Installing apt packages ${fortranPkg} and ${cppPkg}...`);
  await exec.exec("sudo", [
    "apt-get",
    "install",
    "-y",
    "--no-install-recommends",
    fortranPkg,
    cppPkg,
  ]);

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

  core.exportVariable("FC", "ifort");
  core.exportVariable("CC", "icc");
  core.exportVariable("CXX", "icpc");
  core.exportVariable("FORTRAN_COMPILER", "ifort");
  core.exportVariable("FORTRAN_COMPILER_VERSION", version);

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
  // ifort --version often prints a multi-line copyright header.
  // We grab just the first line which contains the actual version string.
  return output.trim().split("\n")[0];
}
