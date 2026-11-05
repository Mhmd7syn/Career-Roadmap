# Data

**Status:** todo

Foundational introduction to data engineering: relational queries, tabular representations, file formats, and the transition from transactional to analytical data.

## Learning Outcomes
- Understand the core architectural distinction between transactional databases (OLTP) and analytical warehouses (OLAP).
- Write standard SQL queries applying filters, table joins, group-by aggregations, and sorting.
- Recognize primary data formats (CSV, JSON, Parquet) and fundamental tabular schema constraints.
- Set up a lightweight local data exploration tool (DuckDB or SQLite) to query and validate datasets.

## Checkpoint
- [ ] Can you write a SQL query using `JOIN`, `GROUP BY`, and `HAVING` from scratch?
- [ ] When should data be stored in columnar Parquet vs. row-based CSV/JSON?
- [ ] Can you explain why running heavy analytics on an operational OLTP database is dangerous?

## Links & Resources
- [SQLBolt: Interactive Lessons & In-Browser Practice Queries](https://sqlbolt.com/)
- [Select Star SQL: Interactive Real-World Data Exercises](https://selectstarsql.com/)
- [DuckDB Quickstart: Fast Local Analytical SQL Drills](https://duckdb.org/docs/guides/sql_introduction/introduction.html)
