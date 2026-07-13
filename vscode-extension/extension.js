const vscode = require('vscode');
const { convertSqlToLinq } = require('./src/sqlinq-converter');

const DEFAULT_TELEMETRY_ENDPOINT = 'https://sqlinq.vercel.app/api/events/conversion';

const SAMPLE_SQL = `SELECT CustomerId, Name
FROM Customers
WHERE IsActive = 1
ORDER BY Name;`;

function getTelemetryConfig() {
  const cfg = vscode.workspace.getConfiguration('sqlinq');
  const configured = String(cfg.get('telemetryEndpoint') || '').trim();
  const databaseType = String(cfg.get('databaseType') || 'connected').trim().toLowerCase();
  return {
    endpoint: configured || DEFAULT_TELEMETRY_ENDPOINT,
    source: String(cfg.get('telemetrySource') || 'vscode-extension').trim(),
    databaseType,
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
  return {
    queryFingerprint: `f${fnv1a32(compact)}`,
    querySummary: clauses.length ? `Clauses: ${clauses.join(', ')}` : 'SQL conversion',
    sqlLength: compact.length,
    clauseProfile: clauses,
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
  if (!telemetry.endpoint) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    await fetch(telemetry.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: telemetry.source,
        isTest: false,
        databaseType: data.connectivityMode === 'with' ? telemetry.databaseType : 'without',
        ...data,
      }),
      signal: controller.signal,
    });
  } catch {
    // Telemetry sync is best-effort and should never block conversion UX.
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
  const result = convertSqlToLinq(sqlText, target);
  return result.ok
    ? result
    : {
        ok: false,
        error: result.error,
        output: '',
        status: result.error,
      };
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
  if (!result.ok) {
    vscode.window.showErrorMessage(result.error);
    await sendConversionEvent({
      connectivityMode: 'without',
      target,
      ...safeSummary,
      parseStatus: 'Fail',
      convertStatus: 'Fail',
      correctness: 0,
      exactMatch: false,
      timeMs: Date.now() - start,
      issue: null,
      message: result.error,
    });
    return;
  }

  await editor.edit((editBuilder) => {
    editBuilder.replace(selection, result.output);
  });

  vscode.window.showInformationMessage(`Quick convert complete. ${result.status}`);
  const inferred = inferStatuses(result);
  await sendConversionEvent({
    connectivityMode: 'without',
    target,
    ...safeSummary,
    parseStatus: inferred.parseStatus,
    convertStatus: inferred.convertStatus,
    correctness: inferred.correctness,
    exactMatch: inferred.exactMatch,
    timeMs: Date.now() - start,
    issue: null,
    message: result.status,
  });
}

function getWebviewContent(webview, state) {
  const nonce = String(Date.now());
  const styles = [
    '.shell{font-family:var(--vscode-font-family, sans-serif);padding:16px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}',
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '.card{border:1px solid var(--vscode-editorWidget-border, #444);border-radius:8px;padding:12px;background:var(--vscode-sideBar-background, transparent)}',
    'label{display:block;font-size:12px;margin-bottom:6px;opacity:.9}',
    'select,textarea,button{font:inherit}',
    'select,textarea{width:100%;box-sizing:border-box;border:1px solid var(--vscode-input-border, #444);border-radius:6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);padding:8px}',
    'textarea{min-height:220px;resize:vertical;font-family:var(--vscode-editor-font-family, monospace);line-height:1.5}',
    'pre{margin:0;min-height:220px;white-space:pre-wrap;word-break:break-word;padding:8px;border:1px solid var(--vscode-input-border, #444);border-radius:6px;background:var(--vscode-editor-background)}',
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
    '.muted{font-size:12px;opacity:.8}',
    '@media (max-width: 900px){.grid{grid-template-columns:1fr}}',
  ].join('');

  const initialSql = escapeHtml(state.sqlText || SAMPLE_SQL);
  const initialOutput = escapeHtml(state.result.ok ? state.result.output : '');
  const initialStatus = escapeHtml(state.result.status || 'Ready to convert a basic SELECT query.');
  const connectivity = getConnectivityDetails(state.connectivityMode || 'without');
  const initialMode = state.connectivityMode || 'without';
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
      <div class="grid" style="margin-top:12px">
        <div class="card">
          <label for="sql">SQL input</label>
          <textarea id="sql">${initialSql}</textarea>
        </div>
        <div class="card">
          <label>LINQ preview</label>
          <pre id="output">${initialOutput}</pre>
        </div>
      </div>
      <div class="toolbar">
        <button class="primary" id="convert">Convert</button>
        <button class="secondary" id="insert">Insert into editor</button>
        <button class="secondary" id="copy">Copy output</button>
      </div>
      <div class="status" id="status">${initialStatus}</div>
      <div class="outputs">
        <h3>Expected output results in this mode</h3>
        <ul id="modeOutputs">${connectivityRows}</ul>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const sql = document.getElementById('sql');
      const target = document.getElementById('target');
      const connectivity = document.getElementById('connectivity');
      const output = document.getElementById('output');
      const status = document.getElementById('status');
      const modeOutputs = document.getElementById('modeOutputs');

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

      document.getElementById('convert').addEventListener('click', () => {
        vscode.postMessage({ type: 'convert', sql: sql.value, target: target.value, connectivity: connectivity.value });
      });

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

      sql.addEventListener('input', () => {
        vscode.postMessage({ type: 'preview', sql: sql.value, target: target.value, connectivity: connectivity.value });
      });

      target.addEventListener('change', () => {
        vscode.postMessage({ type: 'preview', sql: sql.value, target: target.value, connectivity: connectivity.value });
      });

      connectivity.addEventListener('change', () => {
        vscode.postMessage({ type: 'preview', sql: sql.value, target: target.value, connectivity: connectivity.value });
      });

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'result') {
          setState(message.status, message.output, message.outputs);
        }
      });

      vscode.postMessage({ type: 'preview', sql: sql.value, target: target.value, connectivity: connectivity.value });
    </script>
  </body>
  </html>`;
}

function activate(context) {
  let currentPanel = null;

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

    const initialResult = buildInitialConversion(seedSql, seedTarget);
    panel.webview.html = getWebviewContent(panel.webview, {
      sqlText: seedSql,
      target: seedTarget,
      connectivityMode: seedConnectivity,
      result: initialResult,
    });

    panel.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message !== 'object') return;

      if (message.type === 'preview' || message.type === 'convert') {
        const connectivityMode = message.connectivity || 'without';
        const connectivity = getConnectivityDetails(connectivityMode);
        const start = Date.now();
        const result = buildInitialConversion(message.sql || SAMPLE_SQL, message.target || 'method');
        const safeSummary = buildSafeQuerySummary(message.sql || SAMPLE_SQL);
        panel.webview.postMessage({
          type: 'result',
          status: result.ok
            ? `${result.status} Mode: ${connectivity.label}.`
            : `${result.error} Mode: ${connectivity.label}.`,
          output: result.ok ? result.output : '',
          outputs: connectivity.outputs,
        });
        if (message.type === 'convert') {
          if (!result.ok) {
            vscode.window.showErrorMessage(result.error);
          } else {
            vscode.window.showInformationMessage(`${result.status} Mode: ${connectivity.label}.`);
          }
          const inferred = inferStatuses(result);
          await sendConversionEvent({
            connectivityMode,
            target: message.target || 'method',
            ...safeSummary,
            parseStatus: inferred.parseStatus,
            convertStatus: inferred.convertStatus,
            correctness: inferred.correctness,
            exactMatch: inferred.exactMatch,
            timeMs: Date.now() - start,
            issue: null,
            message: result.ok ? result.status : result.error,
          });
        }
        return;
      }

      if (message.type === 'insert') {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage('Open a file first, then use Insert into editor.');
          return;
        }

        const output = String(message.output || '').trim();
        if (!output) return;

        await applyConversionToEditor({ output }, editor);
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
    if (!result.ok) {
      vscode.window.showErrorMessage(result.error);
      await sendConversionEvent({
        connectivityMode: 'without',
        target: target.value,
        ...safeSummary,
        parseStatus: 'Fail',
        convertStatus: 'Fail',
        correctness: 0,
        exactMatch: false,
        timeMs: Date.now() - start,
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

    vscode.window.showInformationMessage(result.status);
    const inferred = inferStatuses(result);
    await sendConversionEvent({
      connectivityMode: 'without',
      target: target.value,
      ...safeSummary,
      parseStatus: inferred.parseStatus,
      convertStatus: inferred.convertStatus,
      correctness: inferred.correctness,
      exactMatch: inferred.exactMatch,
      timeMs: Date.now() - start,
      issue: null,
      message: result.status,
    });
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

  context.subscriptions.push(disposable);
  context.subscriptions.push(uiDisposable);
  context.subscriptions.push(quickDisposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};