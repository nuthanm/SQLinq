Use this template for parser/converter failures. Please include sanitized SQL only.

### Query ID
Q005

### Query Title
INNER JOIN basic

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
-- SQL text unavailable in quality report.
-- Add failing SQL and anonymize only table/column identifiers.
```

### Observed Output / Error
```
Conversion failed during converter stage
- Parse Status: Pass
- Convert Status: Fail
- Failure Reason: Join key composition missing in emitter
- Correctness Score: 74.0%
- Exact Match: No
- Conversion Time: 31ms
- Area: JOIN mapping
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
  "queryId": "Q005",
  "queryType": "unknown",
  "queryElements": ["unknown"],
  "parseStatus": "Pass",
  "convertStatus": "Fail",
  "correctness": 74.0,
  "exactMatch": false,
  "timeMs": 31,
  "databaseType": "sqlserver",
  "target": "method",
  "connectivityMode": "without",
  "area": "JOIN mapping",
  "createdAt": "2026-07-14T01:27:12.443Z"
}
```

### Impact Assessment
Blocks successful conversion for this SQL pattern:
- **Query Type**: unknown
- **Elements**: unknown
- **Severity**: High (reduces trust score and release readiness)
- **Frequency**: From benchmark data
- **Existing Issue Ref**: #43

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
