# System Design Fundamentals

> **Structural Depth:** Depth $d=2$ | **Parent:** Track 1 Software Engineering

### Core Mental Models
1. **Horizontal Scaling:** Stateless API instances behind round-robin or least-connections load balancers.
2. **Database Scaling:** Read replicas, connection pooling (PgBouncer), vertical sharding, consistent hashing.
3. **CAP Theorem:** Under network partition $P$, choose Consistency $C$ or Availability $A$.
