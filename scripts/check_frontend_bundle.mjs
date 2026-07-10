#!/usr/bin/env node
import { gzipSync } from "node:zlib";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const dist = path.join(root, "frontend", "dist");
const assets = path.join(dist, "assets");
const pyodide = path.join(dist, "pyodide");

const KB = 1024;
const MB = 1024 * KB;

const budgets = {
  initialJs: { raw: 700 * KB, gzip: 250 * KB },
  workbenchRouteJs: { raw: 1.6 * MB, gzip: 600 * KB },
  historyRouteJs: { raw: 1.2 * MB, gzip: 450 * KB },
  monacoEditorJs: { raw: 4.2 * MB, gzip: 1.1 * MB },
  editorWorkerRaw: 350 * KB,
  pyodideWorkerRaw: 20 * KB,
  pyodideAssetsRaw: 15 * MB,
};

const forbiddenWorkers = [
  /^ts\.worker-.*\.js$/,
  /^css\.worker-.*\.js$/,
  /^html\.worker-.*\.js$/,
  /^json\.worker-.*\.js$/,
];

function fail(message) {
  failures.push(message);
}

function formatBytes(bytes) {
  if (bytes >= MB) return `${(bytes / MB).toFixed(2)} MB`;
  return `${(bytes / KB).toFixed(1)} kB`;
}

function gzipSize(filePath) {
  return gzipSync(readFileSync(filePath)).length;
}

function findOne(files, pattern, label) {
  const matches = files.filter((name) => pattern.test(name));
  if (matches.length === 0) {
    fail(`Missing ${label}`);
    return null;
  }
  if (matches.length > 1) {
    fail(`Expected one ${label}, found ${matches.length}: ${matches.join(", ")}`);
    return null;
  }
  return matches[0];
}

function checkSize(filePath, label, budget) {
  const raw = statSync(filePath).size;
  const gz = gzipSize(filePath);
  const rawOk = raw <= budget.raw;
  const gzipOk = gz <= budget.gzip;
  rows.push({
    label,
    raw,
    gzip: gz,
    budget: `${formatBytes(budget.raw)} raw / ${formatBytes(budget.gzip)} gzip`,
    ok: rawOk && gzipOk,
  });
  if (!rawOk || !gzipOk) {
    fail(
      `${label} exceeds budget: ${formatBytes(raw)} raw / ${formatBytes(gz)} gzip > ${formatBytes(budget.raw)} raw / ${formatBytes(budget.gzip)} gzip`,
    );
  }
}

const failures = [];
const rows = [];

if (!existsSync(assets) || !existsSync(pyodide)) {
  console.error("frontend/dist is missing. Run: cd frontend && ./node_modules/.bin/vite build");
  process.exit(1);
}

const assetFiles = readdirSync(assets);
const pyodideFiles = readdirSync(pyodide);

const initial = findOne(assetFiles, /^index-[^.]+\.js$/, "initial index JS chunk");
if (initial) checkSize(path.join(assets, initial), "initial index JS", budgets.initialJs);

const workbench = findOne(
  assetFiles,
  /^ProblemDetailPage-[^.]+\.js$/,
  "ProblemDetailPage JS chunk",
);
if (workbench) {
  checkSize(path.join(assets, workbench), "workbench route JS", budgets.workbenchRouteJs);
}

const history = findOne(assetFiles, /^HistoryPage-[^.]+\.js$/, "HistoryPage JS chunk");
if (history) checkSize(path.join(assets, history), "history route JS", budgets.historyRouteJs);

const monacoEditor = findOne(assetFiles, /^monaco-editor-[^.]+\.js$/, "Monaco editor JS chunk");
if (monacoEditor) {
  checkSize(path.join(assets, monacoEditor), "Monaco editor JS", budgets.monacoEditorJs);
}

const editorWorker = findOne(assetFiles, /^editor\.worker-.*\.js$/, "Monaco editor worker");
if (editorWorker) {
  const raw = statSync(path.join(assets, editorWorker)).size;
  rows.push({
    label: "Monaco editor worker",
    raw,
    gzip: gzipSize(path.join(assets, editorWorker)),
    budget: `${formatBytes(budgets.editorWorkerRaw)} raw`,
    ok: raw <= budgets.editorWorkerRaw,
  });
  if (raw > budgets.editorWorkerRaw) {
    fail(`Monaco editor worker exceeds budget: ${formatBytes(raw)} > ${formatBytes(budgets.editorWorkerRaw)}`);
  }
}

const pyodideWorker = findOne(assetFiles, /^pyodide\.worker-.*\.js$/, "Pyodide bridge worker");
if (pyodideWorker) {
  const raw = statSync(path.join(assets, pyodideWorker)).size;
  rows.push({
    label: "Pyodide bridge worker",
    raw,
    gzip: gzipSize(path.join(assets, pyodideWorker)),
    budget: `${formatBytes(budgets.pyodideWorkerRaw)} raw`,
    ok: raw <= budgets.pyodideWorkerRaw,
  });
  if (raw > budgets.pyodideWorkerRaw) {
    fail(`Pyodide bridge worker exceeds budget: ${formatBytes(raw)} > ${formatBytes(budgets.pyodideWorkerRaw)}`);
  }
}

for (const file of assetFiles) {
  if (forbiddenWorkers.some((pattern) => pattern.test(file))) {
    fail(`Unexpected Monaco language-service worker emitted: ${file}`);
  }
}

const pyodideTotal = pyodideFiles.reduce(
  (sum, file) => sum + statSync(path.join(pyodide, file)).size,
  0,
);
rows.push({
  label: "Pyodide static runtime",
  raw: pyodideTotal,
  gzip: null,
  budget: `${formatBytes(budgets.pyodideAssetsRaw)} raw allowlist`,
  ok: pyodideTotal <= budgets.pyodideAssetsRaw,
});
if (pyodideTotal > budgets.pyodideAssetsRaw) {
  fail(`Pyodide static runtime exceeds allowlist: ${formatBytes(pyodideTotal)} > ${formatBytes(budgets.pyodideAssetsRaw)}`);
}

console.log("Frontend bundle budget check");
for (const row of rows) {
  const gzipText = row.gzip === null ? "" : ` / ${formatBytes(row.gzip)} gzip`;
  const status = row.ok ? "OK" : "FAIL";
  console.log(`${status} ${row.label}: ${formatBytes(row.raw)} raw${gzipText} (budget ${row.budget})`);
}

if (failures.length > 0) {
  console.error("\nBudget failures:");
  for (const item of failures) console.error(`- ${item}`);
  process.exit(1);
}

console.log("\nAll bundle budget checks passed.");
