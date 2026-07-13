# SQL Server Query Test Data

This folder contains SQL Server-formatted query suites for converter testing.

## Files
- SingleSelect.sql: Single-table SELECT patterns (basic, filters, sort, LIKE, NULL, paging)
- JoinSelect.sql: JOIN variants (inner, outer, multi-join, self join)
- Subqueries.sql: Scalar, correlated, EXISTS/NOT EXISTS, derived table subqueries
- CTE.sql: Common table expressions (simple, chained, recursive)
- Aggregates.sql: GROUP BY and HAVING aggregate patterns
- WindowFunctions.sql: ROW_NUMBER, RANK, running totals, LAG/LEAD
- SetOperators.sql: UNION, UNION ALL, INTERSECT, EXCEPT

Use these as canonical SQL Server examples when validating parser and converter behavior.
