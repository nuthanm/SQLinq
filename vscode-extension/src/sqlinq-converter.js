function stripSqlNoise(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim()
    .replace(/;+\s*$/, '');
}

function splitTopLevel(text) {
  const parts = [];
  let current = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const prev = text[i - 1];

    if (ch === "'" && prev !== '\\' && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && prev !== '\\' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble) {
      if (ch === '(') depth += 1;
      if (ch === ')' && depth > 0) depth -= 1;
      if (ch === ',' && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        continue;
      }
    }

    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function cleanIdentifier(identifier) {
  return String(identifier).replace(/[\[\]"]/g, '');
}

function getTableName(tableToken) {
  return cleanIdentifier(tableToken).split('.').pop() || cleanIdentifier(tableToken);
}

function inferAlias(tableToken) {
  const base = getTableName(tableToken).replace(/[^A-Za-z0-9_]/g, '');
  return (base[0] || 'x').toLowerCase();
}

function toCollectionName(tableToken) {
  const base = getTableName(tableToken).replace(/[^A-Za-z0-9_]/g, '');
  return (base[0] || 'x').toLowerCase() + base.slice(1);
}

function isClauseStarter(token) {
  return /^(where|order|group|having|join|inner|left|right|full|cross|union|intersect|except)$/i.test(token);
}

function qualifySqlExpression(expression, alias) {
  const reserved = new Set([
    'AND',
    'OR',
    'NOT',
    'NULL',
    'TRUE',
    'FALSE',
    'LIKE',
    'IN',
    'IS',
    'ASC',
    'DESC',
    'BETWEEN',
  ]);

  let result = String(expression).trim();

  result = result.replace(/\b([A-Za-z_][\w]*)\s+LIKE\s+'([^']*)'/gi, (_match, column, pattern) => {
    const columnRef = `${alias}.${column}`;
    const body = String(pattern).replace(/"/g, '\\"');
    const startsWithWildcard = body.startsWith('%');
    const endsWithWildcard = body.endsWith('%');
    const stripped = body.replace(/^%+|%+$/g, '');

    if (startsWithWildcard && endsWithWildcard) return `${columnRef}.Contains("${stripped}")`;
    if (startsWithWildcard) return `${columnRef}.EndsWith("${stripped}")`;
    if (endsWithWildcard) return `${columnRef}.StartsWith("${stripped}")`;
    return `${columnRef} == "${body}"`;
  });

  result = result.replace(/\bIS\s+NOT\s+NULL\b/gi, '!= null');
  result = result.replace(/\bIS\s+NULL\b/gi, '== null');
  result = result.replace(/\bAND\b/gi, '&&');
  result = result.replace(/\bOR\b/gi, '||');
  result = result.replace(/\bNOT\b/gi, '!');
  result = result.replace(/<>/g, '!=');
  result = result.replace(/\s=\s/g, ' == ');

  return result.replace(/\b([A-Za-z_][\w]*)\b/g, (match, ident, offset, source) => {
    const upper = ident.toUpperCase();
    const prev = source[offset - 1];
    const next = source[offset + match.length];

    if (reserved.has(upper)) return ident;
    if (prev === '.' || prev === '@' || prev === '#') return ident;
    if (next === '(') return ident;
    if (/^\d+$/.test(ident)) return ident;
    if (ident === alias) return ident;

    return `${alias}.${ident}`;
  });
}

function parseOrderBy(orderText, alias) {
  return splitTopLevel(orderText).map((part) => {
    const match = part.match(/^(.*?)(?:\s+(ASC|DESC))?$/i);
    const expression = match && match[1] ? match[1].trim() : part.trim();
    const direction = ((match && match[2]) || 'ASC').toUpperCase();
    return {
      expression: qualifySqlExpression(expression, alias),
      descending: direction === 'DESC',
    };
  });
}

function buildSelectProjection(columns, alias) {
  const items = splitTopLevel(columns.replace(/^DISTINCT\s+/i, '')).filter(Boolean);
  if (items.length === 0 || (items.length === 1 && items[0] === '*')) return alias;

  const projected = items.map((item) => {
    const cleaned = cleanIdentifier(item).trim();
    if (cleaned === '*') return alias;
    if (/^[A-Za-z_][\w.]*$/.test(cleaned)) {
      const columnName = cleaned.split('.').pop() || cleaned;
      return `${alias}.${columnName}`;
    }
    return qualifySqlExpression(cleaned, alias);
  });

  return `new { ${projected.join(', ')} }`;
}

function parseBasicSelect(sql) {
  const normalized = stripSqlNoise(sql);
  const selectMatch = normalized.match(/^select\s+([\s\S]+?)\s+from\s+([\s\S]+)$/i);
  if (!selectMatch) {
    return {
      ok: false,
      error: 'Only basic SELECT ... FROM ... queries are supported yet.',
    };
  }

  const columns = selectMatch[1].trim();
  const fromRest = selectMatch[2].trim();
  const tokens = fromRest.split(/\s+/);
  const table = tokens.shift();
  if (!table) {
    return {
      ok: false,
      error: 'Missing table name after FROM.',
    };
  }

  let alias = null;
  if (tokens.length && !isClauseStarter(tokens[0])) {
    alias = tokens.shift();
  }

  const tail = tokens.join(' ').trim();
  const whereMatch = tail.match(/\bwhere\b([\s\S]*?)(?=\border\s+by\b|$)/i);
  const orderMatch = tail.match(/\border\s+by\b([\s\S]*)$/i);
  const unsupported = [];

  if (/\bgroup\s+by\b/i.test(tail)) unsupported.push('GROUP BY');
  if (/\bhaving\b/i.test(tail)) unsupported.push('HAVING');
  if (/\bjoin\b/i.test(tail)) unsupported.push('JOIN');
  if (/\bunion\b/i.test(tail)) unsupported.push('UNION');

  return {
    ok: true,
    alias: alias || inferAlias(table),
    collection: toCollectionName(table),
    columns,
    where: whereMatch ? whereMatch[1].trim() : '',
    orderBy: orderMatch ? orderMatch[1].trim() : '',
    unsupported,
  };
}

function buildMethodChain(parsed) {
  const selectProjection = buildSelectProjection(parsed.columns, parsed.alias);
  const orderItems = parsed.orderBy ? parseOrderBy(parsed.orderBy, parsed.alias) : [];
  const chain = [parsed.collection];

  if (parsed.where) {
    chain.push(`Where(${parsed.alias} => ${qualifySqlExpression(parsed.where, parsed.alias)})`);
  }

  for (let i = 0; i < orderItems.length; i += 1) {
    const item = orderItems[i];
    const method = i === 0 ? (item.descending ? 'OrderByDescending' : 'OrderBy') : item.descending ? 'ThenByDescending' : 'ThenBy';
    chain.push(`${method}(${parsed.alias} => ${item.expression})`);
  }

  if (selectProjection !== parsed.alias) {
    chain.push(`Select(${parsed.alias} => ${selectProjection})`);
  }

  return `${chain[0]}${chain.length > 1 ? `\n  .${chain.slice(1).join('\n  .')}` : ''};`;
}

function buildQuerySyntax(parsed) {
  const selectProjection = buildSelectProjection(parsed.columns, parsed.alias);
  const orderItems = parsed.orderBy ? parseOrderBy(parsed.orderBy, parsed.alias) : [];
  const lines = [`from ${parsed.alias} in ${parsed.collection}`];

  if (parsed.where) {
    lines.push(`where ${qualifySqlExpression(parsed.where, parsed.alias)}`);
  }

  if (orderItems.length) {
    const orderText = orderItems.map((item) => `${item.expression}${item.descending ? ' descending' : ''}`).join(', ');
    lines.push(`orderby ${orderText}`);
  }

  lines.push(`select ${selectProjection}`);
  return lines.join('\n');
}

function buildEfCoreSyntax(parsed) {
  const selectProjection = buildSelectProjection(parsed.columns, parsed.alias);
  const orderItems = parsed.orderBy ? parseOrderBy(parsed.orderBy, parsed.alias) : [];
  const lines = [parsed.collection];

  if (parsed.where) {
    lines.push(`  .Where(${parsed.alias} => ${qualifySqlExpression(parsed.where, parsed.alias)})`);
  }

  for (let i = 0; i < orderItems.length; i += 1) {
    const item = orderItems[i];
    const method = i === 0 ? (item.descending ? 'OrderByDescending' : 'OrderBy') : item.descending ? 'ThenByDescending' : 'ThenBy';
    lines.push(`  .${method}(${parsed.alias} => ${item.expression})`);
  }

  if (selectProjection !== parsed.alias) {
    lines.push(`  .Select(${parsed.alias} => ${selectProjection})`);
  }

  return `${lines.join('\n')};`;
}

function convertSqlToLinq(sql, target) {
  const parsed = parseBasicSelect(sql);
  if (!parsed.ok) return parsed;

  let output = '';
  if (target === 'query') {
    output = buildQuerySyntax(parsed);
  } else if (target === 'ef') {
    output = buildEfCoreSyntax(parsed);
  } else {
    output = buildMethodChain(parsed);
  }

  const recognized = ['SELECT', 'FROM'];
  if (parsed.where) recognized.push('WHERE');
  if (parsed.orderBy) recognized.push('ORDER BY');

  const notes = [`Recognized ${recognized.join(', ')}.`];
  if (parsed.unsupported.length) {
    notes.push(`Unsupported yet: ${parsed.unsupported.join(', ')}.`);
  }

  return {
    ok: true,
    output,
    status: notes.join(' '),
  };
}

module.exports = {
  convertSqlToLinq,
};