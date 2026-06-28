function run(): void {
  try {
    const fc = process.env.FC;
    const cc = process.env.CC;
    const cxx = process.env.CXX;
    const fpmFc = process.env.FPM_FC;
    const fpmCc = process.env.FPM_CC;
    const fpmCxx = process.env.FPM_CXX;
    const f77 = process.env.F77;
    const f90 = process.env.F90;

    const outputFc = process.env.OUTPUT_FC;
    const outputCc = process.env.OUTPUT_CC;
    const outputCxx = process.env.OUTPUT_CXX;
    const outputVersion = process.env.OUTPUT_VERSION;

    const envs: Record<string, string | undefined> = {
      FC: fc,
      CC: cc,
      CXX: cxx,
      FPM_FC: fpmFc,
      FPM_CC: fpmCc,
      FPM_CXX: fpmCxx,
      F77: f77,
      F90: f90,
      OUTPUT_FC: outputFc,
      OUTPUT_CC: outputCc,
      OUTPUT_CXX: outputCxx,
      OUTPUT_VERSION: outputVersion,
    };

    for (const [name, value] of Object.entries(envs)) {
      if (!value) {
        throw new Error(`${name} environment variable is not set.`);
      }
    }

    if (fc !== outputFc) {
      throw new Error(
        `FC (${String(fc)}) does not match OUTPUT_FC (${String(outputFc)})`,
      );
    }
    if (fpmFc !== outputFc) {
      throw new Error(
        `FPM_FC (${String(fpmFc)}) does not match OUTPUT_FC (${String(
          outputFc,
        )})`,
      );
    }
    if (f77 !== outputFc) {
      throw new Error(
        `F77 (${String(f77)}) does not match OUTPUT_FC (${String(outputFc)})`,
      );
    }
    if (f90 !== outputFc) {
      throw new Error(
        `F90 (${String(f90)}) does not match OUTPUT_FC (${String(outputFc)})`,
      );
    }

    if (cc !== outputCc) {
      throw new Error(
        `CC (${String(cc)}) does not match OUTPUT_CC (${String(outputCc)})`,
      );
    }
    if (fpmCc !== outputCc) {
      throw new Error(
        `FPM_CC (${String(fpmCc)}) does not match OUTPUT_CC (${String(
          outputCc,
        )})`,
      );
    }

    if (cxx !== outputCxx) {
      throw new Error(
        `CXX (${String(cxx)}) does not match OUTPUT_CXX (${String(outputCxx)})`,
      );
    }
    if (fpmCxx !== outputCxx) {
      throw new Error(
        `FPM_CXX (${String(fpmCxx)}) does not match OUTPUT_CXX (${String(
          outputCxx,
        )})`,
      );
    }

    console.log("Installation verification successful!");
  } catch (error) {
    if (error instanceof Error) {
      console.error(`::error::Verification failed: ${error.message}`);
    } else {
      console.error(`::error::Verification failed: ${String(error)}`);
    }
    process.exit(1);
  }
}

run();
