import * as core from "@actions/core";
import * as os from "os";
import { parseInputs } from "../src/parse_input";
import { Compiler, OS, Arch, WindowsEnv, LATEST } from "../src/types";

jest.mock("@actions/core");
jest.mock("os");

describe("parseInputs", () => {
  const mockedGetInput = core.getInput as jest.MockedFunction<
    typeof core.getInput
  >;
  const mockedArch = os.arch as jest.MockedFunction<typeof os.arch>;

  let originalPlatform: string;

  beforeAll(() => {
    originalPlatform = process.platform;
  });

  afterAll(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetInput.mockReturnValue("");
    mockedArch.mockReturnValue("x64");
    setPlatform("linux");
  });

  function setPlatform(platform: string) {
    Object.defineProperty(process, "platform", {
      value: platform,
      configurable: true,
    });
  }

  it("returns default values when no inputs are provided", () => {
    const result = parseInputs();
    expect(result).toEqual({
      compiler: Compiler.GCC,
      version: LATEST,
      os: OS.Linux,
      arch: Arch.X64,
      windowsEnv: WindowsEnv.Native,
    });
  });

  it("handles whitespace-only inputs by falling back to defaults where appropriate", () => {
    mockedGetInput.mockReturnValue("  ");
    const result = parseInputs();
    expect(result).toEqual({
      compiler: Compiler.GCC,
      version: LATEST,
      os: OS.Linux,
      arch: Arch.X64,
      windowsEnv: WindowsEnv.Native,
    });
  });

  describe("compiler input", () => {
    it("parses valid compiler names case-insensitively", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return "  IFX  ";
        return "";
      });
      const result = parseInputs();
      expect(result.compiler).toBe(Compiler.IFX);
    });

    it.each([
      [Compiler.NVFortran, "nvfortran"],
      [Compiler.AOCC, "aocc"],
      [Compiler.LFortran, "lfortran"],
    ])("parses %s compiler", (expected, input) => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return input;
        return "";
      });
      expect(parseInputs().compiler).toBe(expected);
    });

    it("throws error for unknown compiler", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return "unknown-compiler";
        return "";
      });
      expect(() => parseInputs()).toThrow(
        'Unknown compiler "unknown-compiler". Valid options: gcc, ifx, ifort, nvfortran, aocc, lfortran',
      );
    });
  });

  describe("version input", () => {
    it("returns the provided version string", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "version") return "13.2.0";
        return "";
      });
      const result = parseInputs();
      expect(result.version).toBe("13.2.0");
    });

    it("handles year-based versions like 2022.2.1", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "version") return "2022.2.1";
        return "";
      });
      const result = parseInputs();
      expect(result.version).toBe("2022.2.1");
    });

    it("handles short year-based versions like 2025.2", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "version") return "2025.2";
        return "";
      });
      const result = parseInputs();
      expect(result.version).toBe("2025.2");
    });

    it("trims whitespace from version strings", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "version") return "  14.1  ";
        return "";
      });
      const result = parseInputs();
      expect(result.version).toBe("14.1");
    });
  });

  describe("mixed inputs", () => {
    it("correctly merges provided inputs with defaults", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "compiler") return "ifort";
        // version is missing, should be default
        return "";
      });
      const result = parseInputs();
      expect(result).toMatchObject({
        compiler: Compiler.IFort,
        version: LATEST,
        os: OS.Linux,
      });
    });
  });

  describe("windows-env input", () => {
    it("parses valid windows-env names case-insensitively", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "windows-env") return " UCRT64 ";
        return "";
      });
      const result = parseInputs();
      expect(result.windowsEnv).toBe(WindowsEnv.UCRT64);
    });

    it.each([
      [WindowsEnv.MinGW64, "mingw64"],
      [WindowsEnv.MSYS2, "msys2"],
    ])("parses %s windows-env", (expected, input) => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "windows-env") return input;
        return "";
      });
      expect(parseInputs().windowsEnv).toBe(expected);
    });

    it("throws error for unknown windows-env", () => {
      mockedGetInput.mockImplementation((name) => {
        if (name === "windows-env") return "msys"; // incomplete
        return "";
      });
      expect(() => parseInputs()).toThrow(
        'Unknown windows-env "msys". Valid options: ucrt64, mingw64, msys2, native',
      );
    });
  });

  describe("OS detection", () => {
    it("detects Linux", () => {
      setPlatform("linux");
      expect(parseInputs().os).toBe(OS.Linux);
    });

    it("detects MacOS", () => {
      setPlatform("darwin");
      expect(parseInputs().os).toBe(OS.MacOS);
    });

    it("detects Windows", () => {
      setPlatform("win32");
      expect(parseInputs().os).toBe(OS.Windows);
    });

    it("throws for unsupported OS", () => {
      setPlatform("freebsd");
      expect(() => parseInputs()).toThrow(
        'Not implemented yet: "freebsd" case',
      );
    });
  });

  describe("Architecture detection", () => {
    it("detects x64", () => {
      mockedArch.mockReturnValue("x64");
      expect(parseInputs().arch).toBe(Arch.X64);
    });

    it("detects arm64", () => {
      mockedArch.mockReturnValue("arm64");
      expect(parseInputs().arch).toBe(Arch.ARM64);
    });

    it("throws for unsupported architecture", () => {
      mockedArch.mockReturnValue("arm" as any);
      expect(() => parseInputs()).toThrow('Not implemented yet: "arm" case');
    });
  });
});
