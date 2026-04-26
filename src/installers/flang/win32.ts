import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as fs from "fs";
import * as tc from "@actions/tool-cache";
import { Arch, type Target } from "../../types";
import { resolveVersion } from "../../resolve_version";

// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// Windows availability of official LLVM clang+llvm-*.tar.xz archives:
//   x64:   18+ (flang absent from official x64 Windows binaries before 18)
//   ARM64: 20+ (no ARM64 Windows archive for 18 or 19)
//
// Only major versions are listed here. Full patch versions (e.g. "22.1.3")
// are validated by extracting the major and checking it against this table.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["22", "21", "20", "19", "18"],
  [Arch.ARM64]: ["22", "21", "20"],
} as const satisfies Record<Arch, readonly string[]>;

// Windows archive suffix per arch, as used in official LLVM GitHub releases.
const WINDOWS_ARCH_SUFFIX: Record<Arch, string> = {
  [Arch.X64]: "x86_64-pc-windows-msvc",
  [Arch.ARM64]: "aarch64-pc-windows-msvc",
};

// Accepts either a bare major ("22") or a full patch version ("22.1.3").
// Rejects anything else (e.g. "22.1") to avoid ambiguity.
function parseVersionInput(input: string): {
  major: string;
  patch: string | undefined;
} {
  const parts = input.split(".");
  if (parts.length === 1) return { major: parts[0], patch: undefined };
  if (parts.length === 3) return { major: parts[0], patch: input };
  throw new Error(
    `Invalid version format: "${input}". ` +
      `Specify either a major version (e.g. "22") or a full patch version (e.g. "22.1.3").`,
  );
}

// Fetches the latest stable patch version for a given LLVM major from the
// GitHub releases API. Returns a full version string like "22.1.3".
async function resolveLatestPatch(major: string): Promise<string> {
  core.info(
    `Resolving latest patch version for LLVM ${major} via GitHub API...`,
  );

  const response = await fetch(
    `https://api.github.com/repos/llvm/llvm-project/releases?per_page=100`,
    { headers: { Accept: "application/vnd.github+json" } },
  );

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed: ${response.status.toString()} ${response.statusText}`,
    );
  }

  const releases = (await response.json()) as {
    tag_name: string;
    prerelease: boolean;
  }[];
  const match = releases.find(
    (r) =>
      r.tag_name.startsWith(`llvmorg-${major}.`) &&
      !r.prerelease &&
      !r.tag_name.includes("rc"),
  );

  if (!match) {
    throw new Error(
      `No stable release found for LLVM major ${major} in the last 100 GitHub releases.`,
    );
  }

  return match.tag_name.replace("llvmorg-", "");
}

// Verifies that a specific patch release exists on GitHub and that the
// platform-specific archive asset is present. Throws with a clear message
// (and a link to the release page) if either check fails.
async function verifyPatchExists(patch: string, arch: Arch): Promise<void> {
  const tag = `llvmorg-${patch}`;
  const filename = `clang+llvm-${patch}-${WINDOWS_ARCH_SUFFIX[arch]}.tar.xz`;

  core.info(`Verifying that ${filename} exists for release ${tag}...`);

  const response = await fetch(
    `https://api.github.com/repos/llvm/llvm-project/releases/tags/${tag}`,
    { headers: { Accept: "application/vnd.github+json" } },
  );

  if (response.status === 404) {
    throw new Error(
      `Requested LLVM version "${patch}" does not exist (no release for ${tag}).`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed for ${tag}: ${response.status.toString()} ${response.statusText}`,
    );
  }

  const release = (await response.json()) as { assets: { name: string }[] };

  if (!release.assets.some((a) => a.name === filename)) {
    throw new Error(
      `LLVM "${patch}" exists but has no Windows ${arch} archive (expected: ${filename}). ` +
        `See https://github.com/llvm/llvm-project/releases/tag/${tag} for available assets.`,
    );
  }
}

// Extracts a .tar.xz archive on Windows using 7-Zip (pre-installed on all
// GitHub Actions Windows runners). The built-in tar.exe on older Windows
// versions (e.g. windows-2022) cannot handle xz compression and will hang.
// 7-Zip decompresses in two passes: .tar.xz -> .tar -> directory.
// Returns the path to the extracted directory.
async function extractTarXz(
  archivePath: string,
  destDir: string,
): Promise<string> {
  const sevenZip = "C:\\Program Files\\7-Zip\\7z.exe";

  // Pass 1: decompress .tar.xz -> .tar in destDir
  core.info("Decompressing .xz with 7-Zip (pass 1/2)...");
  await exec.exec(`"${sevenZip}"`, ["x", archivePath, `-o${destDir}`, "-y"]);

  const tarFile = fs
    .readdirSync(destDir)
    .find((f) => fs.statSync(path.join(destDir, f)).isFile());

  if (!tarFile) {
    throw new Error(`7-Zip pass 1 did not produce a .tar file in ${destDir}.`);
  }

  // Pass 2: extract .tar -> directory in destDir
  core.info("Extracting .tar with 7-Zip (pass 2/2)...");
  const tarPath = path.join(destDir, tarFile);
  await exec.exec(`"${sevenZip}"`, ["x", tarPath, `-o${destDir}`, "-y"]);
  fs.unlinkSync(tarPath);

  // The archive contains a single top-level directory
  // (e.g. clang+llvm-22.1.4-x86_64-pc-windows-msvc). Find and return it.
  const entries = fs.readdirSync(destDir).filter((f) => {
    return fs.statSync(path.join(destDir, f)).isDirectory();
  });

  if (entries.length !== 1) {
    throw new Error(
      `Expected exactly one top-level directory after extraction, found: ${entries.join(", ")}`,
    );
  }

  return path.join(destDir, entries[0]);
}

export async function installWin32(target: Target): Promise<string> {
  const { major, patch: userPatch } = parseVersionInput(target.version);

  // Always validate the major against SUPPORTED_VERSIONS regardless of whether
  // the user supplied a bare major or a full patch. This is the single source
  // of truth for what we support on each arch.
  resolveVersion({ ...target, version: major }, SUPPORTED_VERSIONS);

  let patch: string;

  if (userPatch !== undefined) {
    // User pinned an exact patch — verify it exists before attempting download.
    await verifyPatchExists(userPatch, target.arch);
    patch = userPatch;
  } else {
    // Bare major (or no version) — resolve the latest stable patch via the
    // GitHub API.
    patch = await resolveLatestPatch(major);
  }

  const archSuffix = WINDOWS_ARCH_SUFFIX[target.arch];
  const filename = `clang+llvm-${patch}-${archSuffix}.tar.xz`;
  const downloadUrl = `https://github.com/llvm/llvm-project/releases/download/llvmorg-${patch}/${filename}`;

  core.info(
    `Installing Flang ${major} (${patch}) on Windows (${target.arch})...`,
  );

  // Key the cache on the full patch version so a new patch release always
  // triggers a fresh download rather than serving a stale cached binary.
  let toolRoot = tc.find("flang", patch, target.arch);

  if (!toolRoot) {
    core.info(`Downloading ${filename}...`);
    const downloadPath = await tc.downloadTool(downloadUrl);

    const tempExtractDir = path.join(
      process.env.RUNNER_TEMP ?? "C:\\Temp",
      `flang-extract-${patch}`,
    );
    fs.mkdirSync(tempExtractDir, { recursive: true });

    const extractedDir = await extractTarXz(downloadPath, tempExtractDir);

    core.info("Caching...");
    toolRoot = await tc.cacheDir(extractedDir, "flang", patch, target.arch);
  } else {
    core.info(
      `Flang ${patch} found in tool cache at ${toolRoot}, skipping download.`,
    );
  }

  const binDir = path.join(toolRoot, "bin");
  core.addPath(binDir);

  const flangExe = path.join(binDir, "flang.exe");
  const clangExe = path.join(binDir, "clang.exe");
  const clangPPExe = path.join(binDir, "clang++.exe");

  core.exportVariable("FC", flangExe);
  core.exportVariable("CC", clangExe);
  core.exportVariable("CXX", clangPPExe);
  core.exportVariable("FORTRAN_COMPILER", "flang");
  core.exportVariable("FORTRAN_COMPILER_VERSION", major);

  // Add the lib dir to LIB so the Fortran runtime libraries are findable at
  // link time. On Windows the linker reads LIB, not LIBRARY_PATH.
  const libDir = path.join(toolRoot, "lib");
  const existingLib = process.env.LIB ?? "";
  core.exportVariable("LIB", existingLib ? `${libDir};${existingLib}` : libDir);

  const resolvedVersion = await resolveInstalledVersion(flangExe);
  core.info(`Flang ${resolvedVersion} installed successfully.`);
  return resolvedVersion;
}

async function resolveInstalledVersion(flangExe: string): Promise<string> {
  let output = "";
  await exec.exec(flangExe, ["--version"], {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString();
      },
    },
  });
  return output.trim();
}
