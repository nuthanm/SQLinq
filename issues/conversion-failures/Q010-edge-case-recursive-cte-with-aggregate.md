# [Conversion Failure] Q010 - Edge case - recursive CTE with aggregate

## 1. Summary
- Query ID: Q010
- Query Title: Edge case - recursive CTE with aggregate
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
| Correctness | 52.0% |
| Exact Match | No |
| Convert Time | 36 ms |
| Existing Issue Ref | #59 |
| Event Time | 2026-07-13T17:29:03.811Z |

## 3. Failure Details
- Failure Reason: Recursive CTE with aggregate rewrite loses hierarchy projection semantics
- Converter Status Message: Failed
- Regression Area: Edge case failures

## 4. Reproduction Steps
1. Open SQLinq converter in VS Code.
2. Set target to method.
3. Set connectivity mode to without.
4. Run conversion for query Q010.
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
