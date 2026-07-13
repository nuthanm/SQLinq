import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const thisFile = fileURLToPath(import.meta.url);
const extensionRoot = path.resolve(path.dirname(thisFile), '..');
const extensionPath = path.join(extensionRoot, 'extension.js');
const converterPath = path.join(extensionRoot, 'src', 'sqlinq-converter.js');

function createSandbox() {
  return {
    module: { exports: {} },
    exports: {},
    require: (id) => {
      if (id === 'vscode') {
        return {
          workspace: { getConfiguration: () => ({ get: () => '' }) },
          window: {
            showInformationMessage: () => {},
            showWarningMessage: () => {},
            showErrorMessage: () => {},
          },
          commands: { registerCommand: () => ({ dispose() {} }) },
          ViewColumn: { Beside: 2 },
        };
      }
      if (id === './src/sqlinq-converter') {
        return require(converterPath);
      }
      if (id === './runtime-config.json') {
        return {};
      }
      return require(id);
    },
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    AbortController,
    fetch: globalThis.fetch,
  };
}

async function loadSummaryFunction() {
  const source = await readFile(extensionPath, 'utf8');
  const instrumented = `${source}\nmodule.exports.__buildSafeQuerySummary = buildSafeQuerySummary;`;
  const sandbox = createSandbox();
  vm.runInNewContext(instrumented, sandbox, { filename: extensionPath });
  return sandbox.module.exports.__buildSafeQuerySummary;
}

const samples = [
  ['StartsWith', "SELECT CustomerId, Name FROM Customers WHERE Name LIKE 'A%';"],
  ['EndsWith', "SELECT CustomerId, Name FROM Customers WHERE Name LIKE '%son';"],
  ['Contains', "SELECT CustomerId, Name FROM Customers WHERE Name LIKE '%tech%';"],
  ['IS NULL', 'SELECT CustomerId, Name FROM Customers WHERE MiddleName IS NULL;'],
  ['IS NOT NULL', 'SELECT CustomerId, Name FROM Customers WHERE MiddleName IS NOT NULL;'],
  ['Logical Operator - Multi Condition Filter', 'SELECT CustomerId, Name FROM Customers WHERE IsActive = 1 AND CustomerId > 100;'],
  ['TOP filter', 'SELECT TOP (25) CustomerId, Name FROM Customers WHERE IsActive = 1 ORDER BY CustomerId DESC;'],
  ['IN predicate', 'SELECT CustomerId, Name FROM Customers WHERE CustomerId IN (1001, 1002, 1003);'],
  ['BETWEEN predicate', "SELECT CustomerId, Name FROM Customers WHERE CreatedOn BETWEEN '2025-01-01' AND '2025-12-31';"],
  ['CASE expression', "SELECT CustomerId, CASE WHEN IsActive = 1 THEN 'Active' ELSE 'Inactive' END AS StatusName FROM Customers;"],
  ['Computed expression', 'SELECT CustomerId, Name, DATEDIFF(day, CreatedOn, GETDATE()) AS AgeInDays FROM Customers;'],
  ['Paging', 'SELECT CustomerId, Name FROM Customers ORDER BY CustomerId OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY;'],
];

const summarize = await loadSummaryFunction();
const { convertSqlToLinq } = require(converterPath);

for (const [name, sql] of samples) {
  const summary = summarize(sql);
  const conversion = convertSqlToLinq(sql, 'method');
  const linq = conversion.ok ? conversion.output.replace(/\n/g, ' | ') : `ERROR: ${conversion.error}`;

  console.log(`\\n=== ${name} ===`);
  console.log(`Title: ${summary.queryTypeLabel}`);
  console.log(`Summary: ${summary.querySummary}`);
  console.log(`Translator: ${conversion.ok ? conversion.status : conversion.error}`);
  console.log(`LINQ: ${linq}`);
}
