# Distributed Compute & Event Streaming

> **Structural Depth:** Depth $d=2$ | **Parent:** Track 2 Data Ecosystem

### Core Mental Models
1. **Spark Driver & Executors:** DAG scheduler divides jobs into stages at shuffle boundaries.
2. **Kafka Partitioning:** Partitions are append-only ordered logs. Ordering is strictly guaranteed within a single partition.
3. **Shuffle Tuning:** Avoiding data skew and expensive full network data shuffling.
