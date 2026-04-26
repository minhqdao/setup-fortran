import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import * as fs from "fs";
import * as tc from "@actions/tool-cache";
import { Arch, type Target } from "../../types";
import { resolveVersion } from "../../resolve_version";

// used as the default if no version was specified by the user.
//
// Windows availability of official LLVM installer packages:
//   x64:   LLVM-*.exe (win64) — available from 18+
//   ARM64: LLVM-*.exe (woa64) — available from 20+
//
// Only major versions are listed here. Full patch versions (e.g. "22.1.3")
// are validated by extracting the major and checking it against this table.
// Make sure the versions are always in descending order. The first one will be
// used as the default if no version was specified by the user.
//
// x64: flang.exe was absent from the official LLVM Windows x64 installer
// through at least LLVM 21. LLVM 22 is the first confirmed working version.
// ARM64: flang has been present since LLVM 20 (Linaro maintains the woa64 build).
//
// Only major versions are listed here. Full patch versions (e.g. "22.1.3")
// are validated by extracting the major and checking it against this table.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["22"],
  [Arch.ARM64]: ["22", "21", "20", "19", "18", "17", "16", "15", "14", "13"],
} as const satisfies Record<Arch, readonly string[]>;

// Windows installer suffix per arch, as used in official LLVM GitHub releases.
// win64 = x86_64, woa64 = Windows on ARM64.
const WINDOWS_INSTALLER_SUFFIX: Record<Arch, string> = {
  [Arch.X64]: "win64",
  [Arch.ARM64]: "woa64",
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
// platform-specific installer asset is present.
async function verifyPatchExists(patch: string, arch: Arch): Promise<void> {
  const tag = `llvmorg-${patch}`;
  const suffix = WINDOWS_INSTALLER_SUFFIX[arch];
  const filename = `LLVM-${patch}-${suffix}.exe`;

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
      `LLVM "${patch}" exists but has no Windows ${arch} installer (expected: ${filename}). ` +
        `See https://github.com/llvm/llvm-project/releases/tag/${tag} for available assets.`,
    );
  }
}

// Extracts an LLVM NSIS .exe installer using 7-Zip (pre-installed on all
// GitHub Actions Windows runners).
async function extractExe(
  installerPath: string,
  destDir: string,
): Promise<string> {
  const sevenZip = "C:\\Program Files\\7-Zip\\7z.exe";
  core.info("Extracting installer with 7-Zip...");
  await exec.exec(`"${sevenZip}"`, ["x", installerPath, `-o${destDir}`, "-y"]);
  return destDir;
}

// Locates the MSVC toolchain and Windows SDK library directories using vswhere
// and adds them to the LIB environment variable so flang's linker backend can
// find libcmt.lib, oldnames.lib, libcpmt.lib, and the Windows SDK libs.
//
// Flang on Windows uses lld-link as its linker, which reads LIB the same way
// MSVC's link.exe does. The GitHub Actions Windows runners have VS installed
// but don't pre-populate LIB for non-MSVC workflows.
async function setupMsvcLibs(arch: Arch): Promise<void> {
  core.info("Locating MSVC and Windows SDK libraries for flang linker...");

  const vswhere =
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";

  // Find VS installation path.
  let vsInstallPath = "";
  await exec.exec(
    `"${vswhere}"`,
    ["-latest", "-property", "installationPath"],
    {
      listeners: {
        stdout: (data: Buffer) => {
          vsInstallPath += data.toString();
        },
      },
    },
  );
  vsInstallPath = vsInstallPath.trim();

  if (!vsInstallPath) {
    core.warning(
      "Could not locate Visual Studio via vswhere. Linker may fail to find CRT libs.",
    );
    return;
  }

  core.info(`Found Visual Studio at: ${vsInstallPath}`);

  // Find the MSVC tools version (e.g. 14.38.33130).
  const vcToolsRoot = path.join(vsInstallPath, "VC", "Tools", "MSVC");
  const vcVersions = fs
    .readdirSync(vcToolsRoot)
    .filter((d) => /^\d+\.\d+\.\d+$/.test(d))
    .sort()
    .reverse();
  const vcVersion = vcVersions[0];
  if (!vcVersion) {
    core.warning("Could not find MSVC tools version directory.");
    return;
  }

  const msvcLibDir = path.join(vcToolsRoot, vcVersion, "lib", arch);
  core.info(`MSVC lib dir: ${msvcLibDir}`);

  // Find the Windows SDK lib directory. The SDK installs under
  // C:\Program Files (x86)\Windows Kits\10\Lib\<version>\um\<arch> and
  // ...\ucrt\<arch>.
  const winsdk10Root = "C:\\Program Files (x86)\\Windows Kits\\10\\Lib";
  const sdkVersions = fs
    .readdirSync(winsdk10Root)
    .filter((d) => /^\d+\.\d+\.\d+\.\d+$/.test(d))
    .sort()
    .reverse();
  const sdkVersion = sdkVersions[0];
  if (!sdkVersion) {
    core.warning("Could not find Windows SDK version directory.");
    return;
  }

  const winsdkUmDir = path.join(winsdk10Root, sdkVersion, "um", arch);
  const winsdkUcrtDir = path.join(winsdk10Root, sdkVersion, "ucrt", arch);
  core.info(`Windows SDK um dir:   ${winsdkUmDir}`);
  core.info(`Windows SDK ucrt dir: ${winsdkUcrtDir}`);

  // Prepend all three dirs to LIB.
  const existing = process.env.LIB ?? "";
  const libDirs = [msvcLibDir, winsdkUmDir, winsdkUcrtDir]
    .filter(fs.existsSync)
    .join(";");

  core.exportVariable("LIB", existing ? `${libDirs};${existing}` : libDirs);
}

export async function installWin32(target: Target): Promise<string> {
  const { major, patch: userPatch } = parseVersionInput(target.version);

  // Always validate the major against SUPPORTED_VERSIONS.
  resolveVersion({ ...target, version: major }, SUPPORTED_VERSIONS);

  let patch: string;

  if (userPatch !== undefined) {
    await verifyPatchExists(userPatch, target.arch);
    patch = userPatch;
  } else {
    patch = await resolveLatestPatch(major);
  }

  const suffix = WINDOWS_INSTALLER_SUFFIX[target.arch];
  const filename = `LLVM-${patch}-${suffix}.exe`;
  const downloadUrl = `https://github.com/llvm/llvm-project/releases/download/llvmorg-${patch}/${filename}`;

  core.info(
    `Installing Flang ${major} (${patch}) on Windows (${target.arch})...`,
  );

  let toolRoot = tc.find("flang", patch, target.arch);

  if (!toolRoot) {
    core.info(`Downloading ${filename}...`);
    const downloadPath = await tc.downloadTool(downloadUrl);

    const tempExtractDir = path.join(
      process.env.RUNNER_TEMP ?? "C:\\Temp",
      `flang-extract-${patch}`,
    );
    fs.mkdirSync(tempExtractDir, { recursive: true });

    await extractExe(downloadPath, tempExtractDir);

    core.info("Caching...");
    toolRoot = await tc.cacheDir(tempExtractDir, "flang", patch, target.arch);
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

  // Add flang's own lib dir to LIB for Fortran runtime libs, then add MSVC
  // and Windows SDK dirs so lld-link can find the CRT (libcmt, oldnames, etc.)
  const flangLibDir = path.join(toolRoot, "lib");
  const existingLib = process.env.LIB ?? "";
  core.exportVariable(
    "LIB",
    existingLib ? `${flangLibDir};${existingLib}` : flangLibDir,
  );

  await setupMsvcLibs(target.arch);

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
