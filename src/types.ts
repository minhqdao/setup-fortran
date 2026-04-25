export const Compiler = {
  GFortran: "gfortran",
  IFX: "ifx",
  IFort: "ifort",
  NVFortran: "nvfortran",
  AOCC: "aocc",
  Flang: "flang",
  LFortran: "lfortran",
} as const;
export type Compiler = (typeof Compiler)[keyof typeof Compiler];

export const OS = {
  Linux: "linux",
  MacOS: "darwin",
  Windows: "win32",
} as const;
export type OS = (typeof OS)[keyof typeof OS];

export const Arch = {
  X64: "x64",
  ARM64: "arm64",
} as const;
export type Arch = (typeof Arch)[keyof typeof Arch];

export const WindowsEnv = {
  Native: "native",
  UCRT64: "ucrt64",
} as const;
export type WindowsEnv = (typeof WindowsEnv)[keyof typeof WindowsEnv];

export interface Target {
  compiler: Compiler;
  version: string;
  os: OS;
  osVersion: string;
  arch: Arch;
  windowsEnv: WindowsEnv;
}

export const LATEST = "latest" as const;
export type Latest = typeof LATEST;
