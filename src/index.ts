import * as core from "@actions/core";
import { parseInputs } from "./parse_inputs";
import { Compiler, type InstallationResult, OS } from "./types";
import { installGFortran } from "./installers/gfortran";
import { installIFX } from "./installers/ifx";
import { installIFort } from "./installers/ifort";
import { installNVFortran } from "./installers/nvfortran";
import { installAOCC } from "./installers/aocc";
import { installFlang } from "./installers/flang";
import { installLFortran } from "./installers/lfortran";
import {
  exportInstallationVariables,
  setInstallationOutputs,
} from "./installation_result";

async function run(): Promise<void> {
  try {
    const inputs = parseInputs();

    core.info(`Compiler  : ${inputs.compiler}`);
    core.info(`Version   : ${inputs.version}`);
    core.info(`OS        : ${inputs.os}`);
    core.info(`OS Version: ${inputs.osVersion}`);
    core.info(`Arch      : ${inputs.arch}`);

    if (inputs.os === OS.Windows) {
      core.info(`Windows env : ${inputs.msystem}`);
    }

    let installationResult: InstallationResult;

    switch (inputs.compiler) {
      case Compiler.GFortran:
        installationResult = await installGFortran(inputs);
        break;
      case Compiler.IFX:
        installationResult = await installIFX(inputs);
        break;
      case Compiler.IFort:
        installationResult = await installIFort(inputs);
        break;
      case Compiler.NVFortran:
        installationResult = await installNVFortran(inputs);
        break;
      case Compiler.AOCC:
        installationResult = await installAOCC(inputs);
        break;
      case Compiler.Flang:
        installationResult = await installFlang(inputs);
        break;
      case Compiler.LFortran:
        installationResult = await installLFortran(inputs);
        break;
    }

    setInstallationOutputs(installationResult);
    exportInstallationVariables(installationResult);

    core.exportVariable("FORTRAN_COMPILER", inputs.compiler);
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

void run();
