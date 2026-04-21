import { type Target } from "../../types";

export async function installDarwin(_: Target): Promise<string> {
  return Promise.reject(new Error("Not implemented"));
}
