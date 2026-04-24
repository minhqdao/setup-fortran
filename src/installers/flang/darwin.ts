import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as path from "path";
import { Arch } from "../../types";
import { resolveVersion } from "../../resolve_version";
import type { Target } from "../../types";

const SUPPORTED_VERSIONS = {
  [Arch.X64]: ["20", "19", "18", "17", "16", "15"],
  [Arch.ARM64]: ["20", "19", "18", "17", "16", "15"],
} as const satisfies Record<Arch, readonly string[]>;

export async function installDarwin(target: Target): Promise<string> {
  const version = resolveVersion(target, SUPPORTED_VERSIONS);
  core.info(
    `Installing Flang (via LLVM ${version}) on macOS (${target.arch}) via Homebrew...`,
  );

  const formula = `llvm@${version}`;
  await exec.exec("brew", ["install", formula]);

  const brewPrefixOutput = await getBrewPrefix();
  const llvmDir = path.join(brewPrefixOutput, "opt", formula);
  const binDir = path.join(llvmDir, "bin");

  // Add LLVM bin to PATH
  core.addPath(binDir);

  // Symlink flang-new to flang if it exists
  const flangNewBinary = path.join(binDir, "flang-new");
  const genericFlang = path.join(binDir, "flang");

  await exec.exec("ln", ["-sf", flangNewBinary, genericFlang]).catch(() => {
    core.info(
      `Could not symlink ${flangNewBinary} to ${genericFlang}, maybe it already exists or is named differently.`,
    );
  });

  const resolvedVersion = await resolveInstalledVersion();
  core.info(`Flang ${resolvedVersion} installed successfully on Darwin.`);
  return resolvedVersion;
}

async function getBrewPrefix(): Promise<string> {
  let output = "";
  await exec.exec("brew", ["--prefix"], {
    listeners: { stdout: (data: Buffer) => (output += data.toString()) },
  });
  return output.trim();
}

async function resolveInstalledVersion(): Promise<string> {
  let output = "";
  // Flang might be flang or flang-new
  try {
    await exec.exec("flang", ["--version"], {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
      },
    });
  } catch {
    await exec.exec("flang-new", ["--version"], {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
      },
    });
  }
  return output.trim();
}
