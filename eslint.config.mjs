/**
 * @copyright Sister Software
 * @license AGPL-3.0
 * @author Teffen Ellis, et al.
 */

import { createESLintPackageConfig } from "@sister.software/eslint-config";

// @ts-check

/**
 * ESLint configuration for the Mailwoman repo. The shared config's default ignores cover `**\/out`,
 * `**\/node_modules`, etc. We extend with the Docusaurus build + cache dirs, which the shared
 * config doesn't know about.
 */
const ESLintConfig = createESLintPackageConfig({
  spdxLicenseIdentifier: "AGPL-3.0",

  ignorePatterns: ["**/out", "**/node_modules"],
});

export default ESLintConfig;
