import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import * as fs from "fs";
import { installDarwin } from "../../../src/installers/flang/darwin";
import {
  Arch,
  Compiler,
  OS,
  Msystem,
  type Target,
  LATEST,
} from "../../../src/types";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/tool-cache", () => ({
  find: jest.fn(),
  downloadTool: jest.fn(),
  extractTar: jest.fn(),
  extractZip: jest.fn(),
  cacheDir: jest.fn(),
}));
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
}));

describe("installDarwin (Flang)", () => {
  beforeAll(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ tag_name: "llvmorg-19.1.7", prerelease: false }],
    } as unknown as Response);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
  const mockedTc = tc as jest.Mocked<typeof tc>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedExportVariable = core.exportVariable as jest.MockedFunction<
    typeof core.exportVariable
  >;

  const baseTarget: Target = {
    compiler: Compiler.Flang,
    version: LATEST,
    os: OS.MacOS,
    osVersion: "13",
    arch: Arch.X64,
    msystem: Msystem.Native,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFs.existsSync.mockReturnValue(true);
    mockedExec.mockImplementation(async (commandLine, args, options) => {
      if (commandLine.includes("flang") && args?.[0] === "--version") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("flang version 18.1.0"));
        }
      }
      if (commandLine === "brew" && args?.[0] === "--prefix") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("/usr/local"));
        }
      }
      if (commandLine === "xcrun" && args?.[0] === "--show-sdk-path") {
        if (options?.listeners?.stdout) {
          options.listeners.stdout(Buffer.from("/path/to/SDK"));
        }
      }
      return 0;
    });
  });

  it("installs via Homebrew when version is LATEST", async () => {
    await installDarwin(baseTarget);

    expect(mockedExec).toHaveBeenCalledWith("brew", ["install", "flang"]);
    });

  it("downloads from GitHub when version is specified", async () => {
    const target = { ...baseTarget, version: "19" };
    mockedTc.find.mockReturnValue("");
    mockedTc.downloadTool.mockResolvedValue("/tmp/llvm.tar.xz");
    mockedTc.extractTar.mockResolvedValue("/tmp/llvm-extracted");
    mockedTc.cacheDir.mockResolvedValue("/cache/llvm");

    await installDarwin(target);

    expect(mockedTc.downloadTool).toHaveBeenCalledWith(
      expect.stringContaining("github.com/llvm/llvm-project/releases/download"),
    );
    expect(mockedTc.extractTar).toHaveBeenCalled();
    expect(core.addPath).toHaveBeenCalledWith(expect.stringContaining("bin"));
  });

  it("exports environment variables", async () => {
    await installDarwin(baseTarget);

    expect(mockedExportVariable).toHaveBeenCalledWith(
      "SDKROOT",
      "/path/to/SDK",
    );
  });

  it("resolves and returns the installed version", async () => {
    const result = await installDarwin(baseTarget);
    expect(result).toEqual({
      version: "flang version 18.1.0",
      fc: "/usr/local/opt/flang/bin/flang",
      cc: "/usr/local/opt/llvm/bin/clang",
      cxx: "/usr/local/opt/llvm/bin/clang++",
    });
  });
});
