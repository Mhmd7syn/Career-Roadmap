# Track 2: Data Ecosystem

> **Track Focus:** Transforming transactional exhaust into analytical warehouses, automated pipelines, and distributed event streams.

---

## Track Modules

1. **`data-analytics` (Advanced SQL & Data Analytics):** Window functions (`ROW_NUMBER`, `DENSE_RANK`, `LEAD`/`LAG`), recursive CTEs, Polars dataframes.
2. **`data-warehousing` (Data Warehousing & dbt):** Dimensional modeling (Kimball Star Schema), dbt transformation DAGs, schema testing.
3. **`data-pipelines` (Pipeline Orchestration & ETL/ELT):** Apache Airflow DAGs, idempotent execution, task mapping, retry backoffs.
4. **`data-bigdata` (Distributed Compute & Streaming):** Apache Spark cluster architecture, PySpark DataFrames, Apache Kafka event partitions.

---

## Analytical SQL Anchor

```sql
WITH daily_revenue AS (
  SELECT
    user_id,
    order_date,
    amount,
    SUM(amount) OVER (
      PARTITION BY user_id 
      ORDER BY order_date 
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_ltv
  FROM orders
)
SELECT * FROM daily_revenue WHERE running_ltv > 500;
```
