Use this template for parser/converter failures. Please include sanitized SQL only.

### Query ID
Q010

### Query Title
Edge case - recursive CTE with aggregate

### Failure Stage
Converter

### Syntax Target
method

### Connectivity Mode
without

### Database Tag
sqlserver

### SQL Input (sanitized)
```sql
Col1 case - Col2 CTE with Col3
```

### Observed Output / Error
```
Conversion failed during converter stage
- Parse Status: Partial
- Convert Status: Fail
- Failure Reason: Recursive CTE with aggregate rewrite loses hierarchy projection semantics
- Correctness Score: 52.0%
- Exact Match: No
- Conversion Time: 36ms
- Area: Edge case failures
```

### Expected LINQ Output
```csharp
// Unable to infer expected LINQ from this SQL shape.
```

### Reproduction Steps
1. Open SQLinq converter in VS Code.
2. Set target syntax to **method**.
3. Set connectivity mode to **without**.
4. Paste a unknown query containing: unknown.
5. Run convert.
6. Observe failure.

### Telemetry Snapshot
```json
{
  "queryId": "Q010",
  "queryType": "unknown",
  "queryElements": ["unknown"],
  "parseStatus": "Partial",
  "convertStatus": "Fail",
  "correctness": 52.0,
  "exactMatch": false,
  "timeMs": 36,
  "databaseType": "sqlserver",
  "target": "method",
  "connectivityMode": "without",
  "area": "Edge case failures",
  "createdAt": "2026-07-14T01:27:12.454Z"
}
```

### Impact Assessment
Blocks successful conversion for this SQL pattern:
- **Query Type**: unknown
- **Elements**: unknown
- **Severity**: High (reduces trust score and release readiness)
- **Frequency**: From benchmark data
- **Existing Issue Ref**: #59

### Validation Checklist
- [x] SQL and LINQ content is sanitized (no secrets).
- [x] Query reproduces consistently.
- [ ] Expected output verified by reviewer.

## 7. Action Checklist
- [ ] Reproduce locally and confirm failure.
- [ ] Add/adjust parser or conversion rule.
- [ ] Add regression test in test suite.
- [ ] Verify output in method/query/ef targets as applicable.
- [ ] Link/close this issue with fix commit.
