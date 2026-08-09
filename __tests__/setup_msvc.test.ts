import * as core from "@actions/core";
import { addMsvcBinFromPath } from "../src/setup_msvc";

jest.mock("@actions/core");

describe("addMsvcBinFromPath", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("persists the MSVC executable directory", () => {
    const msvcBin =
      "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\VC\\Tools\\MSVC\\14.44.35207\\bin\\HostX64\\x64";

    expect(addMsvcBinFromPath(`C:\\tools;${msvcBin};C:\\Windows`)).toBe(
      msvcBin,
    );
    expect(core.addPath).toHaveBeenCalledWith(msvcBin);
  });

  it("warns when the MSVC executable directory is absent", () => {
    expect(addMsvcBinFromPath("C:\\tools;C:\\Windows")).toBeUndefined();
    expect(core.addPath).not.toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledWith(
      "Could not find the MSVC executable directory in PATH.",
    );
  });
});
