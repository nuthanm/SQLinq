# [Conversion Failure] Q006 - UNION two selects

## 1. Summary
- Query ID: Q006
- Query Title: UNION two selects
- Failure Stage: Converter
- Status: Failed
- Severity: High

## 2. Query Metadata
| Field | Value |
|---|---|
| Query Type | unknown |
| Elements | unknown |
| Syntax Target | method |
| Connectivity Mode | without |
| Database Tag | unknown |
| Parse Status | Partial |
| Convert Status | Fail |
| Correctness | 54.0% |
| Exact Match | No |
| Convert Time | 24 ms |
| Existing Issue Ref | #44 |
| Event Time | 2026-07-13T17:29:03.809Z |

## 3. Failure Details
- Failure Reason: Set operator lowering not implemented
- Converter Status Message: Failed
- Regression Area: UNION support

## 4. Reproduction Steps
1. Open SQLinq converter in VS Code.
2. Set target to method.
3. Set connectivity mode to without.
4. Run conversion for query Q006.
5. Observe parser/converter failure.

## 5. Expected vs Actual
### Expected
- Query should convert to valid LINQ for this supported pattern or return a clearly scoped unsupported-clause warning.

### Actual
- Conversion failed during converter stage.

## 6. Impact
- Blocks successful conversion for this query shape.
- Reduces trust score and release readiness.

## 7. Action Checklist
- [ ] Reproduce locally and confirm failure.
- [ ] Add/adjust parser or conversion rule.
- [ ] Add regression test in test suite.
- [ ] Verify output in method/query/ef targets as applicable.
- [ ] Link/close this issue with fix commit.
