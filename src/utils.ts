import * as exec from "@actions/exec";

/**
 * Finds the absolute path of a binary.
 * @param tool The name of the binary to find.
 * @returns The absolute path of the binary.
 */
export async function which(tool: string): Promise<string> {
  const whichCommand = process.platform === "win32" ? "where" : "which";
  try {
    const output = await exec.getExecOutput(whichCommand, [tool], {
      silent: true,
    });
    if (output.exitCode !== 0) {
      throw new Error(`Tool '${tool}' not found (exit code ${output.exitCode})`);
    }
    // 'where' on Windows can return multiple lines, take the first one.
    // 'which' on Unix returns one line.
    const result = output.stdout.trim().split(/\r?\n/)[0].trim();
    if (!result) {
      throw new Error(`Tool '${tool}' not found (empty output)`);
    }
    return result;
  } catch (err) {
    throw new Error(`Failed to resolve path for tool '${tool}': ${err instanceof Error ? err.message : String(err)}`);
  }
}
