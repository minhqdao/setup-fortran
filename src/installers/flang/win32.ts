import type { Target } from "../../types";

export async function installWin32(_: Target): Promise<string> {
  return Promise.reject(new Error("Not implemented"));
}
