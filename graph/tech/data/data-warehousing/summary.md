# Data Warehousing & dbt Transformations

> **Structural Depth:** Depth $d=2$ | **Parent:** Track 2 Data Ecosystem

### Core Mental Models
1. **Star Schema:** Central Fact tables (events, metrics) surrounded by Dimension tables (users, products, dates).
2. **dbt Transformation DAG:** Modularity via `ref()`, schema testing (`not_null`, `unique`), Jinja templating.
3. **Storage vs Compute:** Columnar compression, partition pruning, and clustering keys in modern warehouses.
