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
    const target = parseInputs();

    core.info(`Compiler  : ${target.compiler}`);
    core.info(`Version   : ${target.version}`);
    core.info(`OS        : ${target.os}`);
    core.info(`OS Version: ${target.osVersion}`);
    core.info(`Arch      : ${target.arch}`);

    if (target.os === OS.Windows) {
      core.info(`Windows env : ${target.msystem}`);
    }

    let installationResult: InstallationResult;

    switch (target.compiler) {
      case Compiler.GFortran:
        installationResult = await installGFortran(target);
        break;
      case Compiler.IFX:
        installationResult = await installIFX(target);
        break;
      case Compiler.IFort:
        installationResult = await installIFort(target);
        break;
      case Compiler.NVFortran:
        installationResult = await installNVFortran(target);
        break;
      case Compiler.AOCC:
        installationResult = await installAOCC(target);
        break;
      case Compiler.Flang:
        installationResult = await installFlang(target);
        break;
      case Compiler.LFortran:
        installationResult = await installLFortran(target);
        break;
    }

    setInstallationOutputs(installationResult);
    exportInstallationVariables(installationResult);

    core.exportVariable("FORTRAN_COMPILER", target.compiler);
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

void run();
