import os from "os";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, "../logs/lint.log");

const PATTERNS = {
  console: /console\.(log|debug|info|warn|error)\(/g,
  todo: /TODO|FIXME|HACK|XXX/g,
  debugger: /debugger;/g,
  consoleDirect: /console\./g,
};

const IGNORE_PATTERNS = [
  /node_modules/,
  /\.min\./,
  /dist\//,
  /build\//,
  /coverage\//,
];

const IGNORE_FILES = [
  "package-lock.json",
  "package.json",
  ".git",
  "logs",
  ".github",
];

function shouldIgnore(filePath) {
  return IGNORE_FILES.some((ignore) => filePath.includes(ignore)) ||
    IGNORE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function lintFile(filePath) {
  if (shouldIgnore(filePath)) return { issues: [], errors: 0, warnings: 0 };
  
  const ext = path.extname(filePath);
  if (![".js", ".mjs", ".ts", ".jsx", ".tsx"].includes(ext)) {
    return { issues: [], errors: 0, warnings: 0 };
  }

  const issues = [];
  let content;
  
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (e) {
    return { issues: [], errors: 0, warnings: 0 };
  }

  const lines = content.split("\n");

  lines.forEach((line, index) => {
    if (PATTERNS.consoleDirect.test(line)) {
      issues.push({
        file: filePath,
        line: index + 1,
        column: 1,
        severity: "warning",
        message: "Avoid using console statements, use a proper logging library instead",
        code: "no-console",
      });
    }

    if (PATTERNS.debugger.test(line)) {
      issues.push({
        file: filePath,
        line: index + 1,
        column: 1,
        severity: "error",
        message: "Unexpected debugger statement",
        code: "no-debugger",
      });
    }
  });

  return {
    issues,
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
  };
}

function walkDir(dir, files = []) {
  if (shouldIgnore(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function formatIssues(issues) {
  return issues
    .map((i) => `${i.file}:${i.line}:${i.column} ${i.severity} ${i.code} ${i.message}`)
    .join("\n");
}

export async function lint(fix = false) {
  console.log("🔍 Running linter...\n");

  const files = walkDir(path.join(__dirname, ".."));
  let totalErrors = 0;
  let totalWarnings = 0;
  let allIssues = [];

  for (const file of files) {
    const result = lintFile(file);
    totalErrors += result.errors;
    totalWarnings += result.warnings;
    allIssues = allIssues.concat(result.issues);
  }

  if (allIssues.length > 0) {
    console.log(formatIssues(allIssues));
    console.log("");
  }

  console.log(`📊 Linter Results:`);
  console.log(`   Files checked: ${files.length}`);
  console.log(`   Errors: ${totalErrors}`);
  console.log(`   Warnings: ${totalWarnings}`);

  if (totalErrors > 0) {
    console.log("\n❌ Linting failed with errors!");
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.log("\n⚠️  Linting passed with warnings.");
  } else {
    console.log("\n✅ Linting passed!");
  }

  return { errors: totalErrors, warnings: totalWarnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fix = process.argv.includes("--fix");
  lint(fix);
}
