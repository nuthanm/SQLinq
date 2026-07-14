const vscode = require('vscode');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { convertSqlToLinq } = require('./src/sqlinq-converter');

let runtimeConfig = {};
try {
  runtimeConfig = require('./runtime-config.json');
} catch {
  runtimeConfig = {};
}

const SAMPLE_SQL = '';

function getTelemetryConfig() {
  const cfg = vscode.workspace.getConfiguration('sqlinq');
  const configured = String(cfg.get('telemetryEndpoint') || '').trim();
  const databaseType = String(cfg.get('databaseType') || 'connected').trim().toLowerCase();
  const dbConnectionString = String(cfg.get('dbConnectionString') || '').trim();
  const envBase = String(process.env.SQLINQ_API_BASE_URL || process.env.SITE_URL || '').trim();
  const runtimeEndpoint = String(runtimeConfig.telemetryEndpoint || '').trim();
  const endpoint = configured || runtimeEndpoint || (envBase ? `${envBase.replace(/\/+$/, '')}/api/events/conversion` : '');
  return {
    endpoint,
    source: String(cfg.get('telemetrySource') || 'vscode-extension').trim(),
    databaseType,
    dbConnectionString,
  };
}

function getDbPresets() {
  // Load presets from process env and workspace .env files.
  const presets = {};
  const workspaceEnv = loadWorkspaceEnv();
  const env = { ...workspaceEnv, ...process.env };
  
  // PostgreSQL
  const pgUrl = env.DATABASE_URL
    || env.POSTGRES_URL
    || env.DATABASE_POSTGRESQL
    || env.DATABASE_POSTGRES
    || env.DATABASE_POSTGRESS;
  if (pgUrl) presets.postgresql = pgUrl;
  
  // SQL Server
  const mssqlUrl = env.DATABASE_MSSQL || env.SQL_SERVER_URL || env.DATABASE_SQLSERVER;
  if (mssqlUrl) presets.mssql = mssqlUrl;
  
  // MySQL
  const mysqlUrl = env.DATABASE_MYSQL || env.MYSQL_URL;
  if (mysqlUrl) presets.mysql = mysqlUrl;
  
  // Oracle
  const oracleUrl = env.DATABASE_ORACLE || env.ORACLE_URL;
  if (oracleUrl) presets.oracle = oracleUrl;
  
  return presets;
}

function parseDotEnvText(text) {
  const values = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}

function loadWorkspaceEnv() {
  const folders = vscode.workspace.workspaceFolders || [];
  const firstFolder = folders.length ? folders[0].uri.fsPath : '';
  if (!firstFolder) return {};

  const candidates = ['.env', '.env.local'];
  const merged = {};
  for (const fileName of candidates) {
    try {
      const fullPath = path.join(firstFolder, fileName);
      if (!fs.existsSync(fullPath)) continue;
      const fileText = fs.readFileSync(fullPath, 'utf8');
      Object.assign(merged, parseDotEnvText(fileText));
    } catch {
      // Ignore malformed or inaccessible env files; process env is still used.
    }
  }
  return merged;
}

function getDbPresetTemplate(preset) {
  const key = String(preset || '').toLowerCase();
  if (key === 'postgresql') {
    return 'postgres://user:password@localhost:5432/database';
  }
  if (key === 'mssql') {
    return 'Server=localhost;Database=master;User Id=sa;Password=your_password;Encrypt=true;TrustServerCertificate=true;';
  }
  if (key === 'mysql') {
    return 'mysql://user:password@localhost:3306/database';
  }
  if (key === 'oracle') {
    return 'User Id=user;Password=password;Data Source=localhost:1521/XEPDB1;';
  }
  return '';
}

function resolveDbPresetConnection(preset) {
  const key = String(preset || '').toLowerCase();
  const presets = getDbPresets();
  if (presets[key]) {
    return {
      connectionString: String(presets[key]),
      source: 'environment',
    };
  }
  return {
    connectionString: getDbPresetTemplate(key),
    source: 'template',
  };
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const queryRunStats = new Map();

function recordQueryRun(queryFingerprint, timeMs) {
  const key = String(queryFingerprint || '').trim();
  if (!key) {
    return {
      queryRunCount: 0,
      queryAverageMs: Number(timeMs || 0),
    };
  }

  const previous = queryRunStats.get(key) || { count: 0, totalMs: 0 };
  const nextCount = previous.count + 1;
  const nextTotalMs = previous.totalMs + Number(timeMs || 0);
  queryRunStats.set(key, { count: nextCount, totalMs: nextTotalMs });

  return {
    queryRunCount: nextCount,
    queryAverageMs: Math.round((nextTotalMs / nextCount) * 100) / 100,
  };
}

function buildSafeQuerySummary(sqlText) {
  const compact = String(sqlText || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  const clauses = [];
  if (/\bselect\b/i.test(compact)) clauses.push('SELECT');
  if (/\bfrom\b/i.test(compact)) clauses.push('FROM');
  if (/\bwhere\b/i.test(compact)) clauses.push('WHERE');
  if (/\border\s+by\b/i.test(compact)) clauses.push('ORDER BY');
  if (/\bgroup\s+by\b/i.test(compact)) clauses.push('GROUP BY');
  if (/\bjoin\b/i.test(compact)) clauses.push('JOIN');

  const hasWhere = clauses.includes('WHERE');
  const hasOrderBy = clauses.includes('ORDER BY');
  const hasDistinct = /\bselect\s+distinct\b/i.test(compact);
  const hasWildcard = /^\s*select\s+(?:distinct\s+)?\*\s+from\b/i.test(compact);
  const selectMatch = compact.match(/^\s*select\s+([\s\S]+?)\s+from\b/i);
  const selectText = selectMatch && selectMatch[1] ? String(selectMatch[1]).trim() : '';
  const hasTopFilter = /^\s*select\s+top\s*(?:\(\s*\d+\s*\)|\d+)(?:\s|$)/i.test(compact);
  const hasPaging = /\border\s+by\b[\s\S]*\boffset\s+\d+\s+rows\b[\s\S]*\bfetch\s+next\s+\d+\s+rows\s+only\b/i.test(compact);
  const hasCaseExpression = /\bcase\b[\s\S]*\bwhen\b[\s\S]*\bthen\b[\s\S]*\bend\b/i.test(selectText);
  const hasComputedExpression = !hasCaseExpression && (
    /\b(datediff|dateadd|getdate|len|substring|cast|convert|coalesce|isnull|round|abs)\s*\(/i.test(selectText)
      || /\b[a-z_][\w]*\s*[+\-*/]\s*[a-z_\d][\w]*/i.test(selectText)
  );
  const whereMatch = compact.match(/\bwhere\b([\s\S]*?)(?=\border\s+by\b|\bgroup\s+by\b|\bhaving\b|$)/i);
  const whereText = whereMatch && whereMatch[1] ? String(whereMatch[1]).trim() : '';
  const hasLikeFilter = /\blike\b/i.test(whereText);
  const hasNullFilter = /\bis\s+null\b/i.test(whereText);
  const hasNotNullFilter = /\bis\s+not\s+null\b/i.test(whereText);
  const hasNullCheckFilter = hasNullFilter || hasNotNullFilter;
  const hasInPredicate = /\bin\s*\(/i.test(whereText);
  const hasBetweenPredicate = /\bbetween\b[\s\S]*\band\b/i.test(whereText);
  const hasMultiConditionFilter = /\b(and|or)\b/i.test(whereText);
  const likePatternMatch = whereText.match(/\blike\s+'([^']*)'/i);
  const likePattern = likePatternMatch && likePatternMatch[1] ? String(likePatternMatch[1]) : '';
  const likeType = !hasLikeFilter
    ? 'none'
    : (likePattern.startsWith('%') && likePattern.endsWith('%'))
      ? 'contains'
      : likePattern.startsWith('%')
        ? 'endswith'
        : likePattern.endsWith('%')
          ? 'startswith'
          : 'exact';
  const filterProfile = !hasWhere
    ? 'none'
    : hasLikeFilter
      ? `like-${likeType}`
      : hasNotNullFilter
        ? 'not-null-check'
        : hasNullFilter
          ? 'null-check'
          : hasInPredicate
            ? 'in-predicate'
            : hasBetweenPredicate
              ? 'between-predicate'
              : hasMultiConditionFilter
                ? 'multi-condition'
                : 'basic';

  let filterLabel = 'filter';
  if (filterProfile === 'like-startswith') filterLabel = 'StartsWith filter';
  else if (filterProfile === 'like-endswith') filterLabel = 'EndsWith filter';
  else if (filterProfile === 'like-contains') filterLabel = 'Contains filter';
  else if (filterProfile === 'like-exact') filterLabel = 'LIKE exact-match filter';
  else if (filterProfile === 'null-check') filterLabel = 'IS NULL filter';
  else if (filterProfile === 'not-null-check') filterLabel = 'IS NOT NULL filter';
  else if (filterProfile === 'in-predicate') filterLabel = 'IN predicate filter';
  else if (filterProfile === 'between-predicate') filterLabel = 'BETWEEN predicate filter';
  else if (filterProfile === 'multi-condition') filterLabel = 'multi-condition filter';

  let sortDirection = 'none';
  if (hasOrderBy) {
    const orderMatch = compact.match(/\border\s+by\b([\s\S]*)$/i);
    const orderParts = orderMatch && orderMatch[1] ? orderMatch[1].split(',') : [];
    let sawAsc = false;
    let sawDesc = false;
    for (const part of orderParts) {
      const token = String(part || '').trim();
      if (!token) continue;
      if (/\bdesc\b/i.test(token)) {
        sawDesc = true;
      } else {
        // Default SQL ordering is ascending when direction is omitted.
        sawAsc = true;
      }
    }
    if (sawAsc && sawDesc) sortDirection = 'mixed';
    else if (sawDesc) sortDirection = 'desc';
    else sortDirection = 'asc';
  }
  const fromMatch = compact.match(/\bfrom\s+([^\s,;]+)(?:\s+(?:as\s+)?([a-z_][\w$]*))?/i);
  const aliasCandidate = fromMatch ? String(fromMatch[2] || '').trim() : '';
  const hasAlias = Boolean(aliasCandidate) && !/^(where|order|group|having|join|inner|left|right|full|cross|union|intersect|except)$/i.test(aliasCandidate);

  const queryElementsDetailed = [...clauses];
  queryElementsDetailed.push(hasWildcard ? 'SELECT ALL' : 'COLUMN PROJECTION');
  if (hasAlias) queryElementsDetailed.push('TABLE ALIAS');
  if (hasDistinct) queryElementsDetailed.push('DISTINCT');
  if (hasWhere) {
    if (filterProfile === 'like-startswith') queryElementsDetailed.push('FILTER LIKE STARTSWITH');
    else if (filterProfile === 'like-endswith') queryElementsDetailed.push('FILTER LIKE ENDSWITH');
    else if (filterProfile === 'like-contains') queryElementsDetailed.push('FILTER LIKE CONTAINS');
    else if (filterProfile === 'like-exact') queryElementsDetailed.push('FILTER LIKE EXACT');
    else if (filterProfile === 'null-check') queryElementsDetailed.push('FILTER IS NULL');
    else if (filterProfile === 'not-null-check') queryElementsDetailed.push('FILTER IS NOT NULL');
    else if (filterProfile === 'in-predicate') queryElementsDetailed.push('FILTER IN PREDICATE');
    else if (filterProfile === 'between-predicate') queryElementsDetailed.push('FILTER BETWEEN PREDICATE');
    else if (filterProfile === 'multi-condition') queryElementsDetailed.push('FILTER MULTI-CONDITION');
    else queryElementsDetailed.push('FILTER BASIC');
  }
  if (hasTopFilter) queryElementsDetailed.push('TOP');
  if (hasPaging) queryElementsDetailed.push('PAGING');
  if (hasCaseExpression) queryElementsDetailed.push('CASE EXPRESSION');
  if (hasComputedExpression) queryElementsDetailed.push('COMPUTED EXPRESSION');
  if (hasOrderBy) {
    if (sortDirection === 'desc') queryElementsDetailed.push('ORDER DESCENDING');
    else if (sortDirection === 'mixed') queryElementsDetailed.push('ORDER MIXED DIRECTIONS');
    else queryElementsDetailed.push('ORDER ASCENDING');
  }

  let queryTypeLabel = 'Basic select with column names';
  if (hasWildcard) {
    queryTypeLabel = 'Basic select all columns';
  } else if (hasAlias && !hasWhere && !hasOrderBy) {
    queryTypeLabel = 'Basic select with column names using alias';
  }
  if (hasWhere && hasOrderBy) {
    if (sortDirection === 'desc') {
      queryTypeLabel = hasAlias
        ? `Select with alias, ${filterLabel}, and descending sort`
        : `Select with ${filterLabel} and descending sort`;
    } else if (sortDirection === 'mixed') {
      queryTypeLabel = hasAlias
        ? `Select with alias, ${filterLabel}, and mixed sort directions`
        : `Select with ${filterLabel} and mixed sort directions`;
    } else {
      queryTypeLabel = hasAlias
        ? `Select with alias, ${filterLabel}, and ascending sort`
        : `Select with ${filterLabel} and ascending sort`;
    }
  } else if (hasWhere) {
    queryTypeLabel = hasAlias
      ? `Select with alias and ${filterLabel}`
      : `Select with ${filterLabel}`;
  } else if (hasOrderBy) {
    if (sortDirection === 'desc') {
      queryTypeLabel = hasAlias
        ? 'Select with alias and descending sort'
        : 'Select with descending sort';
    } else if (sortDirection === 'mixed') {
      queryTypeLabel = hasAlias
        ? 'Select with alias and mixed sort directions'
        : 'Select with mixed sort directions';
    } else {
      queryTypeLabel = hasAlias
        ? 'Select with alias and ascending sort'
        : 'Select with ascending sort';
    }
  }
  if (hasDistinct) {
    if (hasWhere && hasOrderBy) {
      if (sortDirection === 'desc') {
        queryTypeLabel = `Distinct select with ${filterLabel} and descending sort`;
      } else if (sortDirection === 'mixed') {
        queryTypeLabel = `Distinct select with ${filterLabel} and mixed sort directions`;
      } else {
        queryTypeLabel = `Distinct select with ${filterLabel} and ascending sort`;
      }
    } else if (hasWhere) {
      queryTypeLabel = `Distinct select with ${filterLabel}`;
    } else {
      queryTypeLabel = 'Distinct select';
    }
  }

  // Prefer specific shape titles so logs can identify exact query types quickly.
  if (hasPaging) {
    queryTypeLabel = 'Select with Paging';
  } else if (hasCaseExpression) {
    queryTypeLabel = 'Select with CASE expression';
  } else if (hasComputedExpression) {
    queryTypeLabel = 'Select with Computed expression';
  } else if (hasTopFilter) {
    queryTypeLabel = 'Select with TOP filter';
  } else if (filterProfile === 'like-startswith') {
    queryTypeLabel = 'Select with StartsWith filter';
  } else if (filterProfile === 'like-endswith') {
    queryTypeLabel = 'Select with EndsWith filter';
  } else if (filterProfile === 'like-contains') {
    queryTypeLabel = 'Select with Contains filter';
  } else if (filterProfile === 'null-check') {
    queryTypeLabel = 'Select with IS NULL filter';
  } else if (filterProfile === 'not-null-check') {
    queryTypeLabel = 'Select with IS NOT NULL filter';
  } else if (filterProfile === 'in-predicate') {
    queryTypeLabel = 'Select with IN predicate filter';
  } else if (filterProfile === 'between-predicate') {
    queryTypeLabel = 'Select with BETWEEN predicate filter';
  } else if (filterProfile === 'multi-condition') {
    queryTypeLabel = 'Select with Logical Operator - Multi Condition Filter';
  }

  const queryFingerprint = `f${fnv1a32(compact)}`;
  const queryTitle = `SQLinq ${queryFingerprint}: ${queryTypeLabel}`;

  return {
    queryFingerprint,
    queryTitle,
    querySummary: queryTitle,
    queryTypeLabel,
    sqlLength: compact.length,
    clauseProfile: clauses,
    queryElementsDetailed,
  };
}

function inferStatuses(result) {
  if (!result || !result.ok) {
    return {
      parseStatus: 'Fail',
      convertStatus: 'Fail',
      exactMatch: false,
      correctness: 0,
    };
  }

  const statusText = String(result.status || '');
  const hasUnsupported = /Unsupported yet:/i.test(statusText);
  return {
    parseStatus: 'Pass',
    convertStatus: hasUnsupported ? 'Partial' : 'Pass',
    exactMatch: !hasUnsupported,
    correctness: hasUnsupported ? 80 : 100,
  };
}

async function sendConversionEvent(data) {
  const telemetry = getTelemetryConfig();
  if (!telemetry.endpoint) {
    return {
      ok: false,
      reason: 'Telemetry endpoint is not configured.',
    };
  }

  const body = JSON.stringify({
    source: telemetry.source,
    isTest: false,
    databaseType: data.connectivityMode === 'with' ? telemetry.databaseType : 'without',
    ...data,
  });

  const postViaHttps = () => new Promise((resolve, reject) => {
    const req = https.request(
      telemetry.endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 5000,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
            resolve();
          } else {
            reject(new Error(`Telemetry sync failed with status ${res.statusCode || 'unknown'}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Telemetry request timeout')));
    req.write(body);
    req.end();
  });

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = setTimeout(() => {
    if (controller) controller.abort();
  }, 5000);
  try {
    if (typeof fetch === 'function') {
      const res = await fetch(telemetry.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller ? controller.signal : undefined,
      });
      if (!res.ok) {
        let details = '';
        try {
          details = (await res.text()).trim();
        } catch {
          details = '';
        }
        throw new Error(`Telemetry sync failed with status ${res.status}${details ? `: ${details}` : ''}`);
      }
    } else {
      await postViaHttps();
    }
    return { ok: true };
  } catch (err) {
    // Telemetry sync is best-effort and should never block conversion UX.
    return {
      ok: false,
      reason: err && err.message ? err.message : 'Unknown telemetry error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function getTargetLabel(target) {
  if (target === 'query') return 'Query syntax';
  if (target === 'ef') return 'EF Core IQueryable';
  return 'Method syntax';
}

function getConnectivityDetails(mode) {
  if (mode === 'with') {
    return {
      label: 'With DB connectivity',
      outputs: [
        'LINQ output with recognized-clause summary and warnings.',
        'Schema and type validation opportunities from connected metadata.',
        'Execution-plan guidance and optional sample-row preview checks.',
        'Higher confidence for type mapping and performance notes.',
      ],
    };
  }

  return {
    label: 'Without DB connectivity',
    outputs: [
      'LINQ output from SQL text only (offline conversion).',
      'Recognized clauses and unsupported-clause warnings.',
      'No live schema validation or execution-plan retrieval.',
      'Fast local conversion with no database dependency.',
    ],
  };
}

function buildInitialConversion(sqlText, target) {
  try {
    const result = convertSqlToLinq(sqlText, target);
    return result && result.ok
      ? result
      : {
          ok: false,
          error: result && result.error ? result.error : 'Conversion failed.',
          output: '',
          status: result && result.error ? result.error : 'Conversion failed.',
        };
  } catch (err) {
    const message = err && err.message ? err.message : 'Conversion threw an unexpected error.';
    return {
      ok: false,
      error: message,
      output: '',
      status: message,
    };
  }
}

function applyConversionToEditor(result, editor) {
  if (!editor) return;

  const selection = editor.selection;
  return editor.edit((editBuilder) => {
    if (selection.isEmpty) {
      editBuilder.insert(selection.active, result.output);
    } else {
      editBuilder.replace(selection, result.output);
    }
  });
}

async function convertSelectionDirect(editor, target = 'method') {
  if (!editor) {
    vscode.window.showInformationMessage('Open a SQL file and select SQL text first.');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showInformationMessage('Select SQL text first, then run SQLinq quick convert.');
    return;
  }

  const sqlText = editor.document.getText(selection).trim();
  if (!sqlText) {
    vscode.window.showInformationMessage('Selection is empty. Select a SQL query first.');
    return;
  }

  const start = Date.now();
  const result = convertSqlToLinq(sqlText, target);
  const safeSummary = buildSafeQuerySummary(sqlText);
  const elapsedMs = Date.now() - start;
  const runMetrics = recordQueryRun(safeSummary.queryFingerprint, elapsedMs);
  if (!result.ok) {
    vscode.window.showErrorMessage(`${safeSummary.queryTitle}. ${result.error}`);
    await sendConversionEvent({
      connectivityMode: 'without',
      target,
      ...safeSummary,
      ...runMetrics,
      parseStatus: 'Fail',
      convertStatus: 'Fail',
      correctness: 0,
      exactMatch: false,
      timeMs: elapsedMs,
      issue: null,
      message: result.error,
    });
    return;
  }

  await editor.edit((editBuilder) => {
    editBuilder.replace(selection, result.output);
  });

  vscode.window.showInformationMessage(`Quick convert complete. ${safeSummary.queryTitle}. Runs: ${runMetrics.queryRunCount}, average: ${runMetrics.queryAverageMs} ms. ${result.status}`);
  const inferred = inferStatuses(result);
  const sync = await sendConversionEvent({
    connectivityMode: 'without',
    target,
    ...safeSummary,
    ...runMetrics,
    parseStatus: inferred.parseStatus,
    convertStatus: inferred.convertStatus,
    correctness: inferred.correctness,
    exactMatch: inferred.exactMatch,
    timeMs: elapsedMs,
    issue: null,
    message: result.status,
  });
  if (sync.ok) {
    vscode.window.showInformationMessage('Telemetry synced to dashboard.');
  } else {
    vscode.window.showInformationMessage('Conversion succeeded. Telemetry is currently unavailable.');
  }
}

function getWebviewContent(webview, state) {
  const nonce = String(Date.now());
  const extensionVersion = (vscode.extensions.getExtension('sqlinq.sqlinq-vscode-extension') || vscode.extensions.getExtension('sqlinq.sqlinq'))?.packageJSON?.version || 'unknown';
  const styles = [
    '.shell{font-family:var(--vscode-font-family, sans-serif);padding:16px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}',
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '.card{border:1px solid var(--vscode-editorWidget-border, #444);border-radius:8px;padding:12px;background:var(--vscode-sideBar-background, transparent)}',
    'label{display:block;font-size:12px;margin-bottom:6px;opacity:.9}',
    'select,textarea,button{font:inherit}',
    'select,textarea{width:100%;box-sizing:border-box;border:1px solid var(--vscode-input-border, #444);border-radius:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);padding:8px}',
    'textarea{min-height:220px;resize:vertical;font-family:var(--vscode-editor-font-family, monospace);line-height:1.5}',
    'pre{margin:0;min-height:80px;white-space:pre-wrap;word-break:break-word;padding:8px;border:1px solid var(--vscode-input-border, #444);border-radius:6px;background:var(--vscode-editor-background)}',
    '.linq-pre{min-height:220px}',
    '.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.status{margin-top:10px;font-size:12px;opacity:.85}',
    '.outputs{margin-top:10px;border:1px solid var(--vscode-editorWidget-border, #444);border-radius:8px;padding:10px;background:var(--vscode-sideBar-background, transparent)}',
    '.outputs h3{margin:0 0 6px;font-size:12px;font-weight:600}',
    '.outputs ul{margin:0;padding-left:18px;font-size:12px;line-height:1.5;opacity:.9}',
    '.outputs li{margin-bottom:4px}',
    '.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}',
    'button{border:1px solid var(--vscode-button-border, transparent);border-radius:6px;padding:8px 12px;cursor:pointer}',
    '.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}',
    '.secondary{background:transparent;color:var(--vscode-foreground)}',
    '.danger{background:var(--vscode-inputValidation-errorBackground, #5a1d1d);color:var(--vscode-foreground)}',
    '.muted{font-size:12px;opacity:.8}',
    '.db-section{margin-top:14px;border:1px solid var(--vscode-editorWidget-border, #444);border-radius:8px;padding:12px;background:var(--vscode-sideBar-background, transparent)}',
    '.db-section h3{margin:0 0 8px;font-size:13px;font-weight:600}',
    '.result-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}',
    '.result-table th,.result-table td{border:1px solid var(--vscode-editorWidget-border, #444);padding:4px 8px;text-align:left}',
    '.result-table th{background:var(--vscode-sideBar-background, transparent);font-weight:600}',
    '.rec-list{margin:6px 0 0;padding-left:18px;font-size:12px;line-height:1.6}',
    '.rec-list li{margin-bottom:2px}',
    '.placeholder{font-size:12px;opacity:.75;padding:8px;border:1px dashed var(--vscode-editorWidget-border, #444);border-radius:6px;background:var(--vscode-editor-background)}',
    '.shortcut-hint{font-size:11px;opacity:.6;margin-left:6px}',
    '.conn-row{margin-top:12px}',
    '.conn-grid{display:grid;grid-template-columns:minmax(180px,1fr) minmax(260px,2fr) auto auto;gap:8px;align-items:end;width:100%}',
    '.conn-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}',
    '.conn-grid button{white-space:nowrap;min-width:66px}',
    '.conn-note{font-size:11px;opacity:.7}',
    'code{background:#2a2a2a;color:#a8e6a8;padding:2px 6px;border-radius:3px;font-family:"Courier New",monospace;font-size:11px;word-break:break-all}',
    '.footer{margin-top:12px;padding-top:6px;text-align:right;font-size:11px;opacity:.7;border-top:1px solid var(--vscode-editorWidget-border, #444)}',
    '@media (max-width: 1080px){.conn-grid{grid-template-columns:1fr 1fr auto auto}}',
    '@media (max-width: 900px){.grid{grid-template-columns:1fr}.conn-grid{grid-template-columns:1fr}.conn-grid button{width:100%}}',
  ].join('');

  const initialSql = escapeHtml(state.sqlText || '');
  const initialOutput = '';
  const initialStatus = 'Ready. Click Convert to generate LINQ preview.';
  const connectivity = getConnectivityDetails(state.connectivityMode || 'without');
  const initialMode = state.connectivityMode || 'without';
  const initialConnectionString = escapeHtml(state.dbConnectionString || '');
  const connectivityRows = connectivity.outputs.map((line) => `<li>${escapeHtml(line)}</li>`).join('');

  return `<!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <style>${styles}</style>
    <title>SQLinq Converter</title>
  </head>
  <body>
    <div class="shell">
      <h2>SQLinq Converter</h2>
      <p class="muted">Select SQL, choose an output style, then convert or insert the LINQ back into the editor.</p>
      <div class="row">
        <div style="min-width:220px;flex:1">
          <label for="target">Target</label>
          <select id="target">
            <option value="method" ${state.target === 'method' ? 'selected' : ''}>Method syntax</option>
            <option value="query" ${state.target === 'query' ? 'selected' : ''}>Query syntax</option>
            <option value="ef" ${state.target === 'ef' ? 'selected' : ''}>EF Core IQueryable</option>
          </select>
        </div>
        <div style="min-width:220px;flex:1">
          <label for="connectivity">Connectivity</label>
          <select id="connectivity">
            <option value="without" ${initialMode === 'without' ? 'selected' : ''}>Without DB connectivity</option>
            <option value="with" ${initialMode === 'with' ? 'selected' : ''}>With DB connectivity</option>
          </select>
        </div>
        <div style="min-width:220px;flex:1">
          <label>Preset</label>
          <div class="muted">${escapeHtml(getTargetLabel(state.target))}</div>
        </div>
      </div>
      <div class="row" id="connectionControls" style="margin-top:12px;display:${initialMode === 'with' ? 'flex' : 'none'}">
        <div class="conn-grid">
        <div style="min-width:200px;flex:1">
          <label for="dbPreset">Database Preset</label>
          <select id="dbPreset">
            <option value="">-- None (manual entry) --</option>
            <option value="postgresql">PostgreSQL</option>
            <option value="mssql">SQL Server</option>
            <option value="mysql">MySQL</option>
            <option value="oracle">Oracle</option>
          </select>
        </div>
        <div style="min-width:280px;flex:2">
          <label for="connectionString">Connection String</label>
          <input id="connectionString" type="text" placeholder="postgres://... or server=..." value="${initialConnectionString}" style="width:100%;padding:6px;border:1px solid var(--vscode-input-border, #444);border-radius:4px;background:var(--vscode-input-background);color:var(--vscode-foreground);font-size:12px" />
        </div>
        <button class="secondary" id="testConnection" title="Test connection">Test</button>
        <button class="secondary" id="saveConnection" title="Save to VS Code settings">Save</button>
        </div>
      </div>
      <div id="connectionStatus" style="margin-top:8px;padding:8px;border-radius:4px;font-size:13px;display:${initialMode === 'with' ? 'none' : 'none'};background:var(--vscode-editorWidget-border, transparent)">
        <span id="statusDot" style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;background:#ccc"></span>
        <span id="statusText">Not tested</span>
      </div>
      <div class="grid" style="margin-top:12px">
        <div class="card">
          <label for="sql">SQL input <span class="shortcut-hint">Ctrl+Shift+L to convert · Ctrl+Shift+Q quick convert · Ctrl+Shift+R run &amp; explain</span></label>
          <textarea id="sql">${initialSql}</textarea>
        </div>
        <div class="card">
          <label>LINQ preview</label>
          <pre id="output" class="linq-pre">${initialOutput}</pre>
        </div>
      </div>

      <div class="toolbar">
        <button class="primary" id="convert" title="Ctrl+Shift+L">Convert</button>
        <button class="secondary" id="insert" title="Insert LINQ into active editor">Insert into editor</button>
        <button class="secondary" id="copy" title="Copy LINQ to clipboard">Copy output</button>
        <button class="secondary" id="runQuery" title="Ctrl+Shift+R — Run query and show execution-plan details">Run &amp; Explain</button>
      </div>
      <div class="status" id="status">${initialStatus}</div>
      <div class="status muted" id="telemetryStatus">Telemetry: idle</div>
      <div class="db-section" id="dbSection" style="display:none">
        <h3>Live DB results <span class="muted" id="dbElapsed"></span></h3>
        <div id="dbResultWrap"></div>
        <h3 style="margin-top:12px">Execution plan / explain details</h3>
        <pre id="dbExplain" style="min-height:60px;font-size:11px">Run &amp; Explain to see plan details here (operators, cost, timing, rows, loops, or engine-native output).</pre>
        <h3 style="margin-top:12px">Performance recommendations</h3>
        <ul class="rec-list" id="dbRecs"><li class="placeholder">Recommendations will appear after query execution based on the execution plan and SQL shape.</li></ul>
      </div>
      <div class="outputs">
        <h3>Expected output results in this mode</h3>
        <ul id="modeOutputs">${connectivityRows}</ul>
      </div>
      <div class="footer">SQLinq v${escapeHtml(extensionVersion)}</div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const sql = document.getElementById('sql');
      const target = document.getElementById('target');
      const connectivity = document.getElementById('connectivity');
      const output = document.getElementById('output');
      const status = document.getElementById('status');
      const telemetryStatus = document.getElementById('telemetryStatus');
      const modeOutputs = document.getElementById('modeOutputs');
      const connectionControls = document.getElementById('connectionControls');
      const connectionString = document.getElementById('connectionString');
      const dbPreset = document.getElementById('dbPreset');
      const dbSection = document.getElementById('dbSection');
      const dbResultWrap = document.getElementById('dbResultWrap');
      const dbExplain = document.getElementById('dbExplain');
      const dbRecs = document.getElementById('dbRecs');
      const dbElapsed = document.getElementById('dbElapsed');
      const connectionStatus = document.getElementById('connectionStatus');
      let telemetryTimer = null;

      function setState(nextStatus, nextOutput, outputs) {
        status.textContent = nextStatus;
        output.textContent = nextOutput;
        if (Array.isArray(outputs)) {
          modeOutputs.innerHTML = outputs.map((line) => {
            const li = document.createElement('li');
            li.textContent = line;
            return li.outerHTML;
          }).join('');
        }
      }

      function renderDbResults(data) {
        dbSection.style.display = '';
        dbElapsed.textContent = data.elapsedMs != null ? '(' + data.elapsedMs + ' ms · ' + (data.rowCount || 0) + ' rows)' : '';
        if (data.columns && data.columns.length) {
          const thead = '<thead><tr>' + data.columns.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead>';
          const rows = (data.rows || []).map((row) =>
            '<tr>' + data.columns.map((c) => '<td>' + String(row[c] != null ? row[c] : '') + '</td>').join('') + '</tr>'
          ).join('');
          dbResultWrap.innerHTML = '<table class="result-table">' + thead + '<tbody>' + rows + '</tbody></table>';
        } else {
          dbResultWrap.textContent = data.message || 'No rows returned.';
        }
        
        // Render structured EXPLAIN ANALYZE output
        const explainText = data.explainOutput || '';
        if (explainText) {
          const structuredPlan = parseExplainOutput(explainText);
          dbExplain.innerHTML = '<strong style="font-size:13px;display:block;margin-bottom:8px">Execution Plan Analysis:</strong>' + structuredPlan.html;
        } else {
          dbExplain.textContent = 'No EXPLAIN ANALYZE output available for this execution.';
        }
        
        // Parse and display detailed recommendations
        const detailedRecs = parseExplainRecommendations(data.explainOutput || '', sql.value);
        dbRecs.innerHTML = detailedRecs.map((r) => '<li style="margin-bottom:6px">' + r + '</li>').join('');
      }

      function parseExplainOutput(explainText) {
        const lines = explainText.split('\\n').filter(l => l.trim());
        const html = [];
        let nodeInfo = {};

        for (const line of lines) {
          // Main node line: "Seq Scan on table (cost=X..Y rows=Z)"
          const nodeMatch = line.match(/^\\s*(\\w+\\s+\\w+)\\s+on\\s+(\\w+)\\s+\\(cost=([\\d.]+)\\.\\.(\\d+)\\s+rows=([\\d.]+)\\s+width=(\\d+)\\)\\s*\\(actual\\s+time=([\\d.]+)\\.\\.(\\d.+)\\s+rows=([\\d.]+)\\s+loops=(\\d+)\\)/);
          
          if (nodeMatch) {
            const [, scanType, table, costStart, costEnd, rows, width, timeStart, timeEnd, actualRows, loops] = nodeMatch;
            nodeInfo = {
              scanType: scanType.trim(),
              table: table,
              estimatedCost: parseFloat(costEnd),
              estimatedRows: parseFloat(rows),
              actualRows: parseFloat(actualRows),
              actualTime: parseFloat(timeEnd),
              hasIndex: /Index/.test(scanType)
            };
            
            html.push('<div style="background:var(--vscode-sideBar-background);padding:6px;border-radius:4px;margin-bottom:6px;font-family:monospace;font-size:11px">');
            html.push('<strong>' + scanType + '</strong> on <strong>' + table + '</strong><br/>');
            html.push('Est. cost: ' + costStart + '..' + costEnd + ' | Rows: ' + rows + '<br/>');
            html.push('Actual: ' + timeStart + '..' + timeEnd + 'ms | Rows: ' + actualRows + ' | Loops: ' + loops);
            html.push('</div>');
          }
          
          // Buffers line
          if (line.match(/Buffers:/)) {
            html.push('<div style="font-size:11px;opacity:0.8;margin:4px 0">' + line.trim() + '</div>');
          }
          
          // Timing lines
          if (line.match(/Planning Time:|Execution Time:/)) {
            html.push('<div style="font-size:11px;opacity:0.8;margin:4px 0;font-weight:500">' + line.trim() + '</div>');
          }
        }
        
        if (!html.length) {
          const escaped = explainText
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;');
          html.push('<pre style="margin:0;white-space:pre-wrap;font-size:11px">' + escaped + '</pre>');
        }

        return { html: html.join(''), nodeInfo: nodeInfo };
      }

      function parseExplainRecommendations(explainText, sqlText) {
        const recs = [];
        const text = String(explainText || '');
        const sql = String(sqlText || '').toLowerCase();

        // Check for sequential scans
        if (/Seq Scan/i.test(text)) {
          recs.push('<strong>⚠ Sequential Scan Detected:</strong> Consider adding an index on the WHERE clause columns for faster lookups.');
          
          // Analyze WHERE clause to suggest columns
          const whereMatch = sql.match(/where\\s+([^;]*?)(?:order|group|limit|$)/i);
          if (whereMatch) {
            const whereClause = whereMatch[1].trim();
            const columns = whereClause.match(/\\b[a-z_][a-z0-9_]*\\s*[=><]/gi) || [];
            const columnNames = [...new Set(columns.map(c => c.replace(/\\s*[=><].*/, '').trim()))];
            if (columnNames.length) {
              const table = (text.match(/Seq Scan on (\\w+)/) || [])[1] || 'table_name';
              recs.push('💡 <strong>Create Index:</strong> <code style="background:#2a2a2a;padding:2px 4px;border-radius:2px">CREATE INDEX idx_' + table + '_' + columnNames[0].toLowerCase() + ' ON ' + table + '(' + columnNames.join(', ') + ');</code>');
            }
          }
        }

        // Check for high costs
        if (/cost=.*\\.\\.(\\d{3,})/.test(text)) {
          const costMatch = text.match(/cost=.*\\.(\\d{4,})/);
          if (costMatch && parseInt(costMatch[1]) > 1000) {
            recs.push('<strong>⚠ High Estimated Cost:</strong> Query plan shows high cost. Review WHERE predicates and ensure indexes exist on filtered columns.');
          }
        }

        // Check for sort operations
        if (/Sort.*Method/i.test(text)) {
          recs.push('<strong>📊 Sort Operation:</strong> Query includes sorting. Ensure ORDER BY columns are indexed for better performance.');
          const orderMatch = sql.match(/order\\s+by\\s+([^;]*?)(?:limit|$)/i);
          if (orderMatch) {
            const orderCols = orderMatch[1].split(',').map(c => c.trim().split(/\\s+/)[0]);
            const table = (text.match(/(?:Seq|Index)\\s+\\w+\\s+on\\s+(\\w+)/) || [])[1] || 'table_name';
            recs.push('💡 <strong>Index for ORDER BY:</strong> <code style=\"background:#2a2a2a;padding:2px 4px;border-radius:2px\">CREATE INDEX idx_' + table + '_' + orderCols[0].toLowerCase() + ' ON ' + table + '(' + orderCols.join(', ') + ');</code>');
          }
        }

        // Check for SELECT * optimization
        if (/SELECT\\s+\\*/.test(sql)) {
          recs.push('<strong>✓ Column Selection Tip:</strong> Consider using specific columns instead of SELECT * to reduce I/O and memory usage.');
          // Try to extract actual columns from results (would need row data)
          recs.push('💡 <strong>Example:</strong> <code style=\"background:#2a2a2a;padding:2px 4px;border-radius:2px\">SELECT col1, col2, col3 FROM table WHERE ...</code> instead of SELECT *');
        }

        // Check for table size based on rows
        if (/rows=(\\d+)/.test(text)) {
          const rowMatch = text.match(/actual.*rows=(\\d+)/);
          if (rowMatch && parseInt(rowMatch[1]) > 10000) {
            recs.push('<strong>📈 Large Result Set:</strong> Query returns many rows. Consider adding pagination or more specific filters.');
          }
        }

        // Buffers analysis
        if (/Buffers:.*shared\\s+hit=(\\d+)/.test(text)) {
          const hitMatch = text.match(/shared\\s+hit=(\\d+)/);
          if (hitMatch && parseInt(hitMatch[1]) > 0) {
            recs.push('<strong>✓ Cache Efficiency:</strong> Good - most data read from shared buffer cache.');
          }
        }

        if (!recs.length) {
          recs.push('✓ <strong>No Performance Issues Detected:</strong> Query plan looks optimal. Monitor performance over time with larger datasets.');
        }

        return recs;
      }

      function updateConnectionStatus(connected, dbType, dbName, message) {
        const statusDiv = document.getElementById('connectionStatus');
        const statusDot = document.getElementById('statusDot');
        const statusText = document.getElementById('statusText');

        if (connected) {
          statusDot.style.background = '#4CAF50';
          statusText.textContent = 'Connected to ' + (dbType || 'database') + ': ' + (dbName || 'unknown');
        } else {
          statusDot.style.background = '#f44336';
          statusText.textContent = message || 'Not connected';
        }
        statusDiv.style.display = '';
      }

      function updateConnectivityUi(mode) {
        const withDb = mode === 'with';
        connectionControls.style.display = withDb ? 'flex' : 'none';
        if (!withDb) {
          connectionStatus.style.display = 'none';
        }
      }

      updateConnectivityUi(connectivity.value);

      connectivity.addEventListener('change', () => {
        updateConnectivityUi(connectivity.value);
      });

      function startTelemetrySyncIndicator() {
        telemetryStatus.textContent = 'Telemetry: syncing...';
        if (telemetryTimer) {
          clearTimeout(telemetryTimer);
        }
        telemetryTimer = setTimeout(() => {
          telemetryStatus.textContent = 'Telemetry: delayed or unavailable.';
          telemetryTimer = null;
        }, 8000);
      }

      function stopTelemetrySyncIndicator(nextText) {
        if (telemetryTimer) {
          clearTimeout(telemetryTimer);
          telemetryTimer = null;
        }
        if (nextText) {
          telemetryStatus.textContent = nextText;
        }
      }

      document.getElementById('convert').addEventListener('click', () => {
        startTelemetrySyncIndicator();
        vscode.postMessage({ type: 'convert', sql: sql.value, target: target.value, connectivity: connectivity.value });
      });

      document.getElementById('runQuery').addEventListener('click', () => {
        vscode.postMessage({ type: 'runQuery', sql: sql.value, connectionString: connectionString.value });
      });

      document.getElementById('saveConnection').addEventListener('click', () => {
        vscode.postMessage({ type: 'saveConnectionString', connectionString: connectionString.value });
      });

      document.getElementById('testConnection').addEventListener('click', () => {
        vscode.postMessage({ type: 'testConnection', connectionString: connectionString.value });
      });

      if (dbPreset) {
        dbPreset.addEventListener('change', (e) => {
          const preset = e.target.value;
          if (preset) {
            vscode.postMessage({ type: 'loadDbPreset', preset: preset });
          }
        });
      }

      document.getElementById('insert').addEventListener('click', () => {
        vscode.postMessage({ type: 'insert', output: output.textContent });
      });

      document.getElementById('copy').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(output.textContent);
          status.textContent = 'Copied LINQ output to clipboard.';
        } catch {
          status.textContent = 'Copy failed in this editor environment.';
        }
      });

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'result') {
          setState(message.status, message.output, message.outputs);
        }
        if (message.type === 'telemetry') {
          stopTelemetrySyncIndicator(message.status);
        }
        if (message.type === 'connectionSaved') {
          status.textContent = message.status || 'Connection string saved.';
        }
        if (message.type === 'dbResult') {
          renderDbResults(message.data);
          status.textContent = message.statusText || 'Query executed.';
        }
        if (message.type === 'dbError') {
          dbSection.style.display = '';
          const dbErrorText = message.message || 'Unknown database execution error.';
          dbResultWrap.textContent = 'Error: ' + dbErrorText;
          dbExplain.textContent = 'Run & Explain to see plan details here (operators, cost, timing, rows, loops, or engine-native output).';
          dbRecs.innerHTML = '<li class="placeholder">Recommendations will appear after query execution based on the execution plan and SQL shape.</li>';
          status.textContent = 'Database execution failed: ' + dbErrorText;
        }
        if (message.type === 'autoRunQuery') {
          sql.value = message.sql || sql.value;
          vscode.postMessage({ type: 'runQuery', sql: sql.value, connectionString: connectionString.value });
        }
        if (message.type === 'connectionStatus') {
          updateConnectionStatus(message.connected, message.databaseType, message.databaseName, message.message);
        }
        if (message.type === 'dbPresetLoaded') {
          connectionString.value = message.connectionString || '';
          if (dbPreset) {
            // Reset selection so choosing the same preset again still fires change.
            dbPreset.value = '';
          }
          const sourceLabel = message.source === 'environment' ? 'environment/.env' : 'default template';
          status.textContent = 'Loaded ' + (message.preset || 'selected') + ' connection string from ' + sourceLabel + '.';
        }
      });
    </script>
  </body>
  </html>`;
}

function activate(context) {
  let currentPanel = null;
  let lastEditor = vscode.window.activeTextEditor || null;

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      lastEditor = editor;
    }
  }));

  const openWebview = (seedSql = SAMPLE_SQL, seedTarget = 'method', seedConnectivity = 'without') => {
    if (currentPanel) {
      currentPanel.reveal(vscode.ViewColumn.Beside);
      return currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'sqlinqConverter',
      'SQLinq Converter',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    panel.webview.html = getWebviewContent(panel.webview, {
      sqlText: seedSql,
      target: seedTarget,
      connectivityMode: seedConnectivity,
      dbConnectionString: getTelemetryConfig().dbConnectionString,
      result: {
        ok: true,
        output: '',
        status: 'Ready. Click Convert to generate LINQ preview.',
      },
    });

    panel.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message !== 'object') return;

      if (message.type === 'convert') {
        const connectivityMode = message.connectivity || 'without';
        const connectivity = getConnectivityDetails(connectivityMode);
        const start = Date.now();
        const result = buildInitialConversion(message.sql || SAMPLE_SQL, message.target || 'method');
        const safeSummary = buildSafeQuerySummary(message.sql || SAMPLE_SQL);
        const elapsedMs = Date.now() - start;
        const runMetrics = recordQueryRun(safeSummary.queryFingerprint, elapsedMs);
        const metricsText = ` Runs: ${runMetrics.queryRunCount}, average: ${runMetrics.queryAverageMs} ms.`;
        panel.webview.postMessage({
          type: 'result',
          status: result.ok
            ? `${safeSummary.queryTitle}. ${result.status}.${metricsText} Mode: ${connectivity.label}.`
            : `${safeSummary.queryTitle}. ${result.error}.${metricsText} Mode: ${connectivity.label}.`,
          output: result.ok ? result.output : '',
          outputs: connectivity.outputs,
        });
        if (!result.ok) {
          vscode.window.showErrorMessage(result.error);
        } else {
          vscode.window.showInformationMessage(`${result.status} Mode: ${connectivity.label}.`);
        }
        const inferred = inferStatuses(result);
        const sync = await sendConversionEvent({
          connectivityMode,
          target: message.target || 'method',
          ...safeSummary,
          ...runMetrics,
          parseStatus: inferred.parseStatus,
          convertStatus: inferred.convertStatus,
          correctness: inferred.correctness,
          exactMatch: inferred.exactMatch,
          timeMs: elapsedMs,
          issue: null,
          message: result.ok ? result.status : result.error,
        });
        panel.webview.postMessage({
          type: 'telemetry',
          status: sync.ok ? 'Telemetry: synced to dashboard.' : `Telemetry: failed (${sync.reason})`,
        });
        return;
      }

      if (message.type === 'insert') {
        const editor = vscode.window.activeTextEditor || lastEditor;
        if (!editor || editor.document.isClosed) {
          vscode.window.showInformationMessage('Open a file first, then use Insert into editor.');
          return;
        }

        const linqOutput = String(message.output || '').trim();
        if (!linqOutput) return;

        await vscode.window.showTextDocument(editor.document, { preview: false, preserveFocus: true });

        await applyConversionToEditor({ output: linqOutput }, editor);
      }

      if (message.type === 'saveConnectionString') {
        const cfg = vscode.workspace.getConfiguration('sqlinq');
        await cfg.update('dbConnectionString', String(message.connectionString || '').trim(), vscode.ConfigurationTarget.Workspace);
        panel.webview.postMessage({ type: 'connectionSaved', status: 'Connection string saved to workspace settings.' });
        return;
      }

      if (message.type === 'loadDbPreset') {
        const preset = String(message.preset || '').toLowerCase();
        const resolved = resolveDbPresetConnection(preset);
        panel.webview.postMessage({
          type: 'dbPresetLoaded',
          preset: preset,
          source: resolved.source,
          connectionString: resolved.connectionString,
        });
        return;
      }

      if (message.type === 'testConnection') {
        const telemetry = getTelemetryConfig();
        const dbConnStr = String(message.connectionString || telemetry.dbConnectionString || '').trim();

        let detectEndpoint = '';
        if (telemetry.endpoint) {
          try {
            const url = new URL(telemetry.endpoint);
            detectEndpoint = `${url.protocol}//${url.host}/api/db/detect`;
          } catch { /* ignore */ }
        }

        if (!detectEndpoint) {
          panel.webview.postMessage({ type: 'connectionStatus', connected: false, message: 'Configure sqlinq.telemetryEndpoint to test connections.' });
          return;
        }

        try {
          const body = JSON.stringify({ connectionString: dbConnStr });
          let response;
          if (typeof fetch === 'function') {
            const res = await fetch(detectEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
            });
            response = await res.json();
          } else {
            response = await new Promise((resolve, reject) => {
              const url = new URL(detectEndpoint);
              const req = https.request({ hostname: url.hostname, port: url.port || 443, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: false, message: data }); } });
              });
              req.on('error', reject);
              req.write(body);
              req.end();
            });
          }

          if (response && response.ok) {
            panel.webview.postMessage({
              type: 'connectionStatus',
              connected: true,
              databaseType: response.databaseType,
              databaseName: response.databaseName,
              message: response.message,
            });
          } else {
            panel.webview.postMessage({
              type: 'connectionStatus',
              connected: false,
              databaseType: response?.databaseType,
              databaseName: null,
              message: response?.message || 'Connection test failed.',
            });
          }
        } catch (err) {
          panel.webview.postMessage({
            type: 'connectionStatus',
            connected: false,
            message: `Error: ${err.message}`,
          });
        }
        return;
      }

      if (message.type === 'runQuery') {
        const telemetry = getTelemetryConfig();
        const dbConnStr = String(message.connectionString || telemetry.dbConnectionString || '').trim();

        // Derive the DB execute endpoint from the telemetry endpoint base
        let dbEndpoint = '';
        if (telemetry.endpoint) {
          try {
            const url = new URL(telemetry.endpoint);
            dbEndpoint = `${url.protocol}//${url.host}/api/db/execute`;
          } catch { /* ignore */ }
        }

        if (!dbEndpoint) {
          panel.webview.postMessage({ type: 'dbError', message: 'Configure sqlinq.telemetryEndpoint so the extension can reach the SQLinq server endpoint.' });
          return;
        }

        const sqlToRun = String(message.sql || '').trim();
        if (!sqlToRun) {
          panel.webview.postMessage({ type: 'dbError', message: 'No SQL to execute.' });
          return;
        }

        try {
          const body = JSON.stringify({ sql: sqlToRun, explain: true, connectionString: dbConnStr || undefined });
          let response;
          if (typeof fetch === 'function') {
            const res = await fetch(dbEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
            });
            response = await res.json();
          } else {
            response = await new Promise((resolve, reject) => {
              const url = new URL(dbEndpoint);
              const req = https.request({ hostname: url.hostname, port: url.port || 443, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: false, message: data }); } });
              });
              req.on('error', reject);
              req.write(body);
              req.end();
            });
          }

          if (response && response.ok) {
            panel.webview.postMessage({
              type: 'dbResult',
              data: response,
              statusText: `Query returned ${response.rowCount ?? 0} row(s) in ${response.elapsedMs ?? 0} ms.`,
            });
          } else {
            panel.webview.postMessage({
              type: 'dbError',
              message: response?.message || response?.error || response?.details || 'Database execution failed.',
            });
          }
        } catch (err) {
          panel.webview.postMessage({
            type: 'dbError',
            message: err && err.message ? err.message : 'Network error reaching DB endpoint.',
          });
        }
      }
    });

    panel.onDidDispose(() => {
      currentPanel = null;
    });

    currentPanel = panel;
    return panel;
  };

  const disposable = vscode.commands.registerCommand('sqlinq.convertSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('Open a SQL file or select SQL text first.');
      return;
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection).trim();
    const sqlText =
      selectedText ||
      (await vscode.window.showInputBox({
        title: 'SQLinq',
        prompt: 'Paste a simple SQL SELECT statement',
        placeHolder: 'SELECT CustomerId, Name FROM Customers WHERE IsActive = 1 ORDER BY Name',
      }));

    if (!sqlText) return;

    const target = await vscode.window.showQuickPick(
      [
        { label: 'Method syntax', value: 'method' },
        { label: 'Query syntax', value: 'query' },
        { label: 'EF Core IQueryable', value: 'ef' },
      ],
      {
        title: 'SQLinq',
        placeHolder: 'Choose a LINQ output style',
      }
    );

    if (!target) return;

    const start = Date.now();
    const result = convertSqlToLinq(sqlText, target.value);
    const safeSummary = buildSafeQuerySummary(sqlText);
    const elapsedMs = Date.now() - start;
    const runMetrics = recordQueryRun(safeSummary.queryFingerprint, elapsedMs);
    if (!result.ok) {
      vscode.window.showErrorMessage(`${safeSummary.queryTitle}. ${result.error}`);
      await sendConversionEvent({
        connectivityMode: 'without',
        target: target.value,
        ...safeSummary,
        ...runMetrics,
        parseStatus: 'Fail',
        convertStatus: 'Fail',
        correctness: 0,
        exactMatch: false,
        timeMs: elapsedMs,
        issue: null,
        message: result.error,
      });
      return;
    }

    await editor.edit((editBuilder) => {
      if (selection.isEmpty && !selectedText) {
        editBuilder.insert(selection.active, result.output);
      } else {
        editBuilder.replace(selection, result.output);
      }
    });

    vscode.window.showInformationMessage(`${safeSummary.queryTitle}. Runs: ${runMetrics.queryRunCount}, average: ${runMetrics.queryAverageMs} ms. ${result.status}`);
    const inferred = inferStatuses(result);
    const sync = await sendConversionEvent({
      connectivityMode: 'without',
      target: target.value,
      ...safeSummary,
      ...runMetrics,
      parseStatus: inferred.parseStatus,
      convertStatus: inferred.convertStatus,
      correctness: inferred.correctness,
      exactMatch: inferred.exactMatch,
      timeMs: elapsedMs,
      issue: null,
      message: result.status,
    });
    if (sync.ok) {
      vscode.window.showInformationMessage('Telemetry synced to dashboard.');
    } else {
      vscode.window.showInformationMessage('Conversion succeeded. Telemetry is currently unavailable.');
    }
  });

  const uiDisposable = vscode.commands.registerCommand('sqlinq.openConverterUi', async () => {
    const editor = vscode.window.activeTextEditor;
    const selectedText = editor ? editor.document.getText(editor.selection).trim() : '';
    openWebview(selectedText || SAMPLE_SQL, 'method', 'without');
  });

  const quickDisposable = vscode.commands.registerCommand('sqlinq.convertSelectionQuick', async () => {
    const editor = vscode.window.activeTextEditor;
    await convertSelectionDirect(editor, 'method');
  });

  const runQueryDisposable = vscode.commands.registerCommand('sqlinq.runQuery', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('Open a SQL file and select a query first.');
      return;
    }
    const sqlText = editor.document.getText(editor.selection).trim() || editor.document.getText().trim();
    if (!sqlText) {
      vscode.window.showInformationMessage('Select or open a SQL query first.');
      return;
    }
    const panel = openWebview(sqlText, 'method', 'with');
    // Signal webview to auto-run DB execution after it's ready
    setTimeout(() => {
      if (panel && panel.webview) {
        panel.webview.postMessage({ type: 'autoRunQuery', sql: sqlText });
      }
    }, 400);
  });

  context.subscriptions.push(disposable);
  context.subscriptions.push(uiDisposable);
  context.subscriptions.push(quickDisposable);
  context.subscriptions.push(runQueryDisposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};