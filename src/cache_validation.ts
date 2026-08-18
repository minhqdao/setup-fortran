import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as cache from "@actions/cache";

export async function validateRestoredCompilerCache(
  label: string,
  requiredPaths: string[],
  command: string,
  args: string[],
): Promise<boolean> {
  const missing = requiredPaths.filter((entry) => !fs.existsSync(entry));
  if (missing.length > 0) {
    core.warning(
      `Restored ${label} cache is incomplete; missing: ${missing.join(", ")}. Reinstalling.`,
    );
    return false;
  }

  try {
    const exitCode = await exec.exec(command, args, {
      ignoreReturnCode: true,
      silent: true,
    });
    if (exitCode === 0) return true;
    core.warning(
      `Restored ${label} cache failed compiler validation with exit code ${exitCode.toString()}. Reinstalling.`,
    );
  } catch (error) {
    core.warning(
      `Restored ${label} cache failed compiler validation: ${String(error)}. Reinstalling.`,
    );
  }
  return false;
}

export async function saveCompilerCache(
  paths: string[],
  key: string,
  timeoutMs = 10 * 60_000,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      cache.saveCache(paths, key),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `Cache save timed out after ${Math.round(timeoutMs / 60_000).toString()} minutes`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    core.warning(`Could not save compiler cache ${key}: ${String(error)}`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
