import * as core from "@actions/core";
import * as os from "os";
import { Compiler, OS, Arch, WindowsEnv, LATEST, type Target } from "./types";

const DEFAULTS = {
  compiler: Compiler.GFortran,
  version: LATEST,
  windowsEnv: WindowsEnv.Native,
} as const;

function detectOS(): OS {
  switch (process.platform) {
    case "linux":
      return OS.Linux;
    case "darwin":
      return OS.MacOS;
    case "win32":
      return OS.Windows;
    case "aix": {
      throw new Error('Not implemented yet: "aix" case');
    }
    case "android": {
      throw new Error('Not implemented yet: "android" case');
    }
    case "freebsd": {
      throw new Error('Not implemented yet: "freebsd" case');
    }
    case "haiku": {
      throw new Error('Not implemented yet: "haiku" case');
    }
    case "openbsd": {
      throw new Error('Not implemented yet: "openbsd" case');
    }
    case "sunos": {
      throw new Error('Not implemented yet: "sunos" case');
    }
    case "cygwin": {
      throw new Error('Not implemented yet: "cygwin" case');
    }
    case "netbsd": {
      throw new Error('Not implemented yet: "netbsd" case');
    }
  }
}

function detectArch(): Arch {
  switch (os.arch()) {
    case "x64":
      return Arch.X64;
    case "arm64":
      return Arch.ARM64;
    case "arm": {
      throw new Error('Not implemented yet: "arm" case');
    }
    case "ia32": {
      throw new Error('Not implemented yet: "ia32" case');
    }
    case "loong64": {
      throw new Error('Not implemented yet: "loong64" case');
    }
    case "mips": {
      throw new Error('Not implemented yet: "mips" case');
    }
    case "mipsel": {
      throw new Error('Not implemented yet: "mipsel" case');
    }
    case "ppc64": {
      throw new Error('Not implemented yet: "ppc64" case');
    }
    case "riscv64": {
      throw new Error('Not implemented yet: "riscv64" case');
    }
    case "s390x": {
      throw new Error('Not implemented yet: "s390x" case');
    }
  }
}

function parseCompiler(raw: string): Compiler {
  const valid = Object.values(Compiler);
  const val = raw.toLowerCase().trim() as Compiler;
  if (valid.includes(val)) return val;
  throw new Error(
    `Unknown compiler "${raw}". Valid options: ${valid.join(", ")}`,
  );
}

function parseWindowsEnv(raw: string): WindowsEnv {
  const valid = Object.values(WindowsEnv);
  const val = raw.toLowerCase().trim() as WindowsEnv;
  if (valid.includes(val)) return val;
  throw new Error(
    `Unknown windows-env "${raw}". Valid options: ${valid.join(", ")}`,
  );
}

export function parseInputs(): Target {
  const rawCompiler = core.getInput("compiler").trim() || DEFAULTS.compiler;
  const rawVersion = core.getInput("version").trim() || DEFAULTS.version;
  const rawWinEnv = core.getInput("windows-env").trim();

  const compiler = parseCompiler(rawCompiler);
  const detectedOS = detectOS();

  const target: Target = {
    compiler,
    version: rawVersion,
    os: detectedOS,
    osVersion: process.env.ImageOS ?? os.release(),
    arch: detectArch(),
    windowsEnv: rawWinEnv ? parseWindowsEnv(rawWinEnv) : DEFAULTS.windowsEnv,
  };

  return target;
}
