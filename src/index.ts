import * as core from "@actions/core";
import { parseInputs } from "./parse_inputs";
import { Compiler, OS } from "./types";
import { installGFortran } from "./installers/gfortran";
import { installIFX } from "./installers/ifx";
import { installIFort } from "./installers/ifort";
import { installNVFortran } from "./installers/nvfortran";
import { installAOCC } from "./installers/aocc";
import { installLFortran } from "./installers/lfortran";
import { installFlang } from "./installers/flang";

async function run(): Promise<void> {
  try {
    const target = parseInputs();

    core.info(`Compiler  : ${target.compiler}`);
    core.info(`Version   : ${target.version}`);
    core.info(`OS        : ${target.os}`);
    core.info(`OS Version: ${target.osVersion}`);
    core.info(`Arch      : ${target.arch}`);

    if (target.os === OS.Windows) {
      core.info(`Windows env : ${target.windowsEnv}`);
    }

    let installedVersion: string;

    switch (target.compiler) {
      case Compiler.GFortran:
        installedVersion = await installGFortran(target);
        break;
      case Compiler.IFX:
        installedVersion = await installIFX(target);
        break;
      case Compiler.IFort:
        installedVersion = await installIFort(target);
        break;
      case Compiler.NVFortran:
        installedVersion = await installNVFortran(target);
        break;
      case Compiler.AOCC:
        installedVersion = await installAOCC(target);
        break;
      case Compiler.LFortran:
        installedVersion = await installLFortran(target);
        break;
      case Compiler.Flang:
        installedVersion = await installFlang(target);
        break;
    }

    core.setOutput("compiler-version", installedVersion);
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

void run();
