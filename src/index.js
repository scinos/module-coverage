// @ts-check

import fs from "node:fs/promises";
import path from "node:path";
import esquery from "esquery";
import { parse } from "espree";
import debug from "debug";
import { AsciiTable3 } from "ascii-table3";

const { query } = esquery;
const debugLog = debug("coverage");

const isValidAsset = (asset) => asset.url.endsWith(".js");

export const processCoverage = async ({ file, root }) => {
  const content = await fs.readFile(file, "utf8");
  const json = JSON.parse(content);

  for (const asset of json) {
    debugLog(`Processing ${asset.url}`);

    if (!isValidAsset(asset)) {
      debugLog("Asset is not valid");
      continue;
    }
    const { ranges, text } = asset;

    const modules = extractModules(text);
    if (!modules) {
      debugLog("Does not have any module");
      continue;
    }
    const moduleCoverage = await computeSize({
      modules: computeUnusedModules({ modules, ranges }),
      root,
    });

    console.log("===================================================");
    console.log("Asset: ");
    console.log("");
    console.log(`${asset.url}`);
    console.log("");

    printUnusedModules({ modules: moduleCoverage });

    const moduleSummary = computeUnusedPackages({ modules: moduleCoverage });
    printUnusedPackages({ packages: moduleSummary });
  }

  console.log("");
};

/**
 * @param {object} obj
 * @param {[string, number][]} obj.modules
 */
const printUnusedModules = ({ modules }) => {
  const table = new AsciiTable3().setHeading("Size (bytes)", "Module");

  modules
    .sort(([, sizeA], [, sizeB]) => sizeA - sizeB)
    .forEach(([name, size]) => {
      if (size) table.addRow(size, name);
    });

  console.log("Unused modules:");
  console.log();
  console.log(table.setStyle("github-markdown").toString());
};

/**
 *
 * @param {object} obj
 * @param {[string, number][]} obj.packages
 */
const printUnusedPackages = ({ packages }) => {
  if (packages.every(([, size]) => size === 0)) {
    return;
  }

  const table = new AsciiTable3().setHeading("Size (bytes)", "Packages");

  packages
    .sort(([, sizeA], [, sizeB]) => sizeA - sizeB)
    .forEach(([name, size]) => {
      if (size > 0) table.addRow(size, name);
    });

  console.log("Unused external packages:");
  console.log();
  console.log(table.setStyle("github-markdown").toString());
  console.log();
};

/**
 *
 * @param {string} text
 */
const extractModules = (text) => {
  /** @type [string, number, number][] */
  const modules = [];

  const ast = parse(text, {
    range: true,
    ecmaVersion: "latest",
  });

  const webpackModules = query(
    ast,
    "Program > ExpressionStatement > CallExpression > ArrayExpression > ObjectExpression"
  )[0];
  if (!webpackModules) return null;

  for (const module of webpackModules.properties) {
    const moduleName = module.key.value;
    debugLog("Processing module " + moduleName);
    const moduleBody = module.value.body;

    let start, end;
    if (moduleBody.body.length) {
      start = moduleBody.body[0].start;
      end = moduleBody.body[moduleBody.body.length - 1].end;
    } else {
      start = moduleBody.start;
      end = moduleBody.end;
    }
    modules.push([moduleName, start, end]);
  }

  return modules;
};

/**
 * @param {object} obj
 * @param {[string, number, number][]} obj.modules
 * @param {{start: number, end: number}[]} obj.ranges
 * @return {string[]} List of unused modules
 */
const computeUnusedModules = ({ modules, ranges }) => {
  /** @type Record<string, boolean> */
  const moduleCoverage = {};

  const a = modules[0];

  let rangeIndex = 0;
  let moduleIndex = 0;

  while (true) {
    if (moduleIndex >= modules.length) break;
    if (rangeIndex >= ranges.length) break;

    const rangeStart = ranges[rangeIndex].start;
    const rangeEnd = ranges[rangeIndex].end;
    const [moduleName, moduleStart, moduleEnd] = modules[moduleIndex];

    const moduleStartsBeforeCurrentRange = moduleStart <= rangeStart;
    const moduleStartsWithinCurrentRange = moduleStart >= rangeStart;
    const moduleStartsAfterCurrentRange = moduleStart >= rangeEnd;

    const moduleEndsBeforeCurrentRange = moduleEnd <= rangeStart;
    const moduleEndsWithinCurrentRange = moduleEnd <= rangeEnd;
    const moduleEndsAfterCurrentRange = moduleEnd >= rangeEnd;

    if (!(moduleName in moduleCoverage)) {
      moduleCoverage[moduleName] = false;
    }

    // Module fully before current range
    if (moduleEndsBeforeCurrentRange) {
      moduleIndex++;
      continue;
    }

    // Module fully after current range
    if (moduleStartsAfterCurrentRange) {
      rangeIndex++;
      continue;
    }

    // Module fully inside the range
    if (moduleStartsWithinCurrentRange && moduleEndsWithinCurrentRange) {
      moduleCoverage[moduleName] = true;
      moduleIndex++;
      continue;
    }

    // Range fully inside the module
    if (moduleStartsBeforeCurrentRange && moduleEndsAfterCurrentRange) {
      moduleCoverage[moduleName] = true;
      rangeIndex++;
      moduleIndex++;
      continue;
    }

    // Module starts before range, ends within range
    if (moduleStartsBeforeCurrentRange && moduleEndsWithinCurrentRange) {
      moduleCoverage[moduleName] = true;
      moduleIndex++;
      continue;
    }

    // Module starts within range, ends after range
    if (moduleStartsWithinCurrentRange && moduleEndsAfterCurrentRange) {
      moduleCoverage[moduleName] = true;
      moduleIndex++;
      rangeIndex++;
      continue;
    }
  }

  return Object.entries(moduleCoverage)
    .filter(([, used]) => !used)
    .map(([name]) => name);
};

/**
 *
 * @param {object} obj
 * @param {string[]} obj.modules
 * @param {string} [obj.root]
 * @returns {Promise<[string, number][]>} Modules with size
 */
const computeSize = async ({ modules, root }) => {
  if (!root) {
    return modules.map((m) => [m, 0]);
  }

  /** @type [string, number][] */
  const modulesWithSize = [];

  for (const name of modules) {
    try {
      const stats = await fs.stat(path.resolve(root, name));
      modulesWithSize.push([name, stats.size]);
    } catch (err) {
      modulesWithSize.push([name, 0]);
    }
  }

  return modulesWithSize;
};

/**
 * @param {object} obj
 * @param {[string, number][]} obj.modules
 */
const computeUnusedPackages = ({ modules }) => {
  /** @type Record<string, number> */
  const sizeByPackage = {};

  const extractNameRE = /node_modules\/((?:@[^\/]+\/)?[^\/]+)/;
  for (const [name, size] of modules) {
    let match;
    if ((match = name.match(extractNameRE))) {
      const packageName = match[1];

      if (!(packageName in sizeByPackage)) {
        sizeByPackage[packageName] = 0;
      }

      sizeByPackage[packageName] += size;
    }
  }

  return Object.entries(sizeByPackage).filter(([, size]) => size > 0);
};
