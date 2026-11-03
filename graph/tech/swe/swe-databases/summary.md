# Databases & Persistent Storage

> **Structural Depth:** Depth $d=2$ | **Parent:** Track 1 Software Engineering

### Core Mental Models
1. **B-Tree Indexing:** Balanced multi-way search trees ensure $\mathcal{O}(\log N)$ lookups and range scans.
2. **Transaction Isolation Levels:** Read Committed vs Repeatable Read vs Serializable (preventing dirty reads, non-repeatable reads, phantom reads).
3. **Caching Topologies:** Cache-Aside with TTLs, write-through, and cache stampede mitigation (mutex locking / probabilistic early expiration).
