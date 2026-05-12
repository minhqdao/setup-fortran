import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// Notes:
//   - Only major versions are meaningful here: neither llvm.sh nor the apt
//     repository accept minor/patch versions, so the installed patch is always
//     whatever the LLVM apt repo currently serves for that major.
//   - Binary naming history:
//       LLVM 15–16: binary is `flang-new` (F18 rewrite, still under the old name)
//       LLVM 17–19: binary is `flang-new` (same, stabilised)
//       LLVM 20+:   binary renamed to `flang` (flang-new still present as alias)
//   - ARM64: LLVM 15/16 have no noble (24.04) repo and broken jammy (22.04)
//     packaging. 17 is the effective floor on arm64.
//   - X64: LLVM 15/16 are available on jammy (22.04) only; no noble repo.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["22", "21", "20", "19", "18", "17", "16"],
  [Arch.ARM64]: ["22", "21", "20", "19", "18", "17"],
} as const satisfies Record<Arch, readonly string[]>;

// Returns the name of the canonical flang binary for a given major version.
// This reflects the upstream rename from `flang-new` to `flang` in LLVM 20.
function flangBinaryName(major: number): string {
  return major >= 20 ? "flang" : "flang-new";
}

// Resolves the on-disk path of the flang binary after installation.
//
// The apt packages install the real binary under /usr/lib/llvm-<N>/bin/ and
// create symlinks in /usr/bin. The symlink names vary by version and platform:
//
//   LLVM 15–16: packaging is inconsistent — /usr/lib/llvm-N/bin/flang-new
//               exists on some platforms but /usr/bin may only have a bare
//               `flang` or nothing versioned at all.
//   LLVM 17–19: /usr/lib/llvm-N/bin/flang-new is reliable.
//   LLVM 20+:   /usr/lib/llvm-N/bin/flang is the real binary;
//               flang-new is a symlink to it.
//
// We probe the most reliable locations first.
function resolveFlangBinaryPath(major: number, version: string): string {
  const binaryName = flangBinaryName(major);

  const candidates = [
    `/usr/lib/llvm-${version}/bin/${binaryName}`, // most reliable across all versions
    `/usr/bin/${binaryName}-${version}`, // versioned symlink in /usr/bin
    `/usr/bin/flang-new-${version}`, // fallback for 15/16 on some platforms
    `/usr/bin/flang`, // last-resort bare path (15/16 jammy)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      core.info(`Found flang binary at: ${candidate}`);
      return candidate;
    }
  }

  throw new Error(
    `Flang binary not found in any expected location for LLVM ${version}. Checked:\n` +
      candidates.map((c) => `  ${c}`).join("\n"),
  );
}

export async function installDebian(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  const major = parseInt(version, 10);

  core.info(`Installing Flang ${version} on Linux (${target.arch})...`);

  core.info("Fixing apt mirror to avoid Azure mirror timeouts...");
  await exec.exec("sudo", [
    "sed",
    "-i",
    "s|http://azure.archive.ubuntu.com/ubuntu|https://archive.ubuntu.com/ubuntu|g",
    "/etc/apt/sources.list",
  ]);

  core.info(`Adding LLVM ${version} apt repository via apt.llvm.org...`);
  await exec.exec("bash", [
    "-c",
    [
      `curl -fsSL --retry 3 --retry-delay 15 https://apt.llvm.org/llvm.sh`,
      `| sudo bash -s -- ${version}`,
    ].join(" "),
  ]);

  const pkgName = `flang-${version}`;

  core.info(`Installing apt package ${pkgName} with libomp-${version}-dev...`);
  await exec.exec("sudo", [
    "apt-get",
    "install",
    "-y",
    pkgName,
    `libomp-${version}-dev`,
  ]);

  const binaryPath = resolveFlangBinaryPath(major, version);

  // Register the binary under the generic `flang` name so users can always
  // call `flang` regardless of which LLVM major is installed.
  // Skip if the resolved path is already /usr/bin/flang — update-alternatives
  // forbids registering a file as its own alternative.
  if (binaryPath !== "/usr/bin/flang") {
    core.info(
      `Registering update-alternatives: /usr/bin/flang -> ${binaryPath}`,
    );
    await exec.exec("sudo", [
      "update-alternatives",
      "--install",
      "/usr/bin/flang",
      "flang",
      binaryPath,
      "100",
    ]);
  }

  // Add the llvm bin dir to PATH so versioned tools (clang-22, etc.) are
  // reachable in subsequent steps without qualification.
  const llvmBinDir = `/usr/lib/llvm-${version}/bin`;
  if (fs.existsSync(llvmBinDir)) {
    core.addPath(llvmBinDir);
  }

  core.exportVariable("FC", `${flangBinaryName(major)}-${version}`);
  core.exportVariable("CC", `clang-${version}`);
  core.exportVariable("CXX", `clang++-${version}`);
  core.exportVariable("FPM_FC", `${flangBinaryName(major)}-${version}`);
  core.exportVariable("FPM_CC", `clang-${version}`);
  core.exportVariable("FPM_CXX", `clang++-${version}`);
  core.exportVariable("FLANG_VERSION", major);

  // Set LIBRARY_PATH so the Fortran runtime libraries are findable at link
  // time. This is particularly important for LLVM 15/16 where the runtime
  // libs (libFortranRuntime, libFortranDecimal, etc.) are not in the default
  // linker search path.
  const llvmLibDir = `/usr/lib/llvm-${version}/lib`;
  if (fs.existsSync(llvmLibDir)) {
    const existing = process.env.LIBRARY_PATH ?? "";
    core.exportVariable(
      "LIBRARY_PATH",
      existing ? `${llvmLibDir}:${existing}` : llvmLibDir,
    );
  }

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`Flang ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(): Promise<string> {
  const fc = process.env.FC;
  if (!fc) throw new Error("FC is not set");
  let output = "";
  await exec.exec(fc, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
