import { type Target } from "../../types";

export async function installWin32(_: Target): Promise<string> {
  return Promise.reject(new Error("Not implemented"));
}

// const SUPPORTED_VERSIONS = {
//   [Arch.X64]: {
//     [WindowsEnv.Native]: ["15", "14", "13"],
//     [WindowsEnv.UCRT64]: ["15", "14", "13"],
//     [WindowsEnv.MinGW64]: ["14", "13"],
//     [WindowsEnv.MSYS2]: ["14", "13"],
//   },
//   [Arch.ARM64]: {
//     [WindowsEnv.Native]: ["14", "13"],
//     [WindowsEnv.UCRT64]: undefined, // not supported
//     [WindowsEnv.MinGW64]: undefined, // not supported
//     [WindowsEnv.MSYS2]: undefined, // not supported
//   },
// } as const satisfies Record<
//   Arch,
//   Record<WindowsEnv, readonly string[] | undefined>
// >;

// export async function installWin32(target: Target): Promise<string> {
//   const version = resolveWindowsVersion(target, SUPPORTED_VERSIONS);
//   // ...
// }
