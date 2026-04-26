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
// Windows availability of official LLVM installer packages:
//   x64:   LLVM-*.exe (win64) — checking from 18+
//   ARM64: LLVM-*.exe (woa64) — checking from 20+
//
// Only major versions are listed here. Full patch versions (e.g. "22.1.3")
// are validated by extracting the major and checking it against this table.
const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["22", "21", "20", "19", "18"],
  [Arch.ARM64]: ["22", "21", "20"],
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

// Extracts an LLVM .exe installer using 7-Zip (pre-installed on all GitHub
// Actions Windows runners). LLVM .exe installers are NSIS-based and can be
// extracted directly by 7-Zip without running the installer UI.
// Returns the path to the directory containing the extracted contents.
async function extractExe(
  installerPath: string,
  destDir: string,
): Promise<string> {
  const sevenZip = "C:\\Program Files\\7-Zip\\7z.exe";

  core.info("Extracting installer with 7-Zip...");
  await exec.exec(`"${sevenZip}"`, ["x", installerPath, `-o${destDir}`, "-y"]);

  // DEBUG: list all extracted top-level entries so we can see the layout
  core.info("DEBUG: top-level extracted entries:");
  for (const f of fs.readdirSync(destDir)) {
    const fullPath = path.join(destDir, f);
    const isDir = fs.statSync(fullPath).isDirectory();
    core.info(`  ${isDir ? "[DIR] " : "      "}${f}`);
  }

  // DEBUG: search for flang anywhere in the extracted tree
  core.info("DEBUG: searching for flang in extracted tree...");
  function findFlang(dir: string): void {
    for (const f of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, f);
      if (f.toLowerCase().includes("flang")) {
        core.info(`  FOUND: ${fullPath}`);
      }
      if (fs.statSync(fullPath).isDirectory()) {
        findFlang(fullPath);
      }
    }
  }
  findFlang(destDir);

  return destDir;
}

export async function installWin32(target: Target): Promise<string> {
  const { major, patch: userPatch } = parseVersionInput(target.version);

  // Always validate the major against SUPPORTED_VERSIONS regardless of whether
  // the user supplied a bare major or a full patch.
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

    const extractedDir = await extractExe(downloadPath, tempExtractDir);

    // DEBUG: log what we're about to cache
    core.info(`DEBUG: caching contents of: ${extractedDir}`);

    core.info("Caching...");
    toolRoot = await tc.cacheDir(extractedDir, "flang", patch, target.arch);

    // DEBUG: confirm toolRoot and list its bin contents
    core.info(`DEBUG: toolRoot = ${toolRoot}`);
    const binDir2 = path.join(toolRoot, "bin");
    if (fs.existsSync(binDir2)) {
      core.info("DEBUG: bin/ contents:");
      for (const f of fs.readdirSync(binDir2)) {
        core.info(`  bin/${f}`);
      }
    } else {
      core.info("DEBUG: no bin/ directory found in toolRoot");
    }
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
