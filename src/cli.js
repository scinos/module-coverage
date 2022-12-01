#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { processCoverage } from "./index.js";

const args = yargs(hideBin(process.argv))
  .usage("$0 [args]")
  .option("file", {
    alias: "f",
    describe: "Coverage file to process",
  })
  .option("root", {
    alias: "r",
    describe: "Root of the project, used to compute module sizes",
  })
  .demandOption(["f"])
  .help().argv;

processCoverage({ file: args.file, root: args.root });
