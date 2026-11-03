# Operating Systems & Systems

> **Structural Depth:** Depth $d=2$ | **Parent:** Track 0 Core CS

### Core Mental Models
1. **Process vs Thread:** Processes own address spaces, page tables, and file descriptors. Threads share address spaces and heap, with individual stacks.
2. **Virtual Memory & Page Tables:** Hardware MMU translates virtual pages to physical frames; page faults trigger disk/swap I/O.
3. **Linux Concurrency:** Mutexes, semaphores, atomic operations, and preventing deadlocks (Coffman conditions).

### Systems Invariant
- **Context Switch Penalty:** Involves saving CPU register state, switching kernel stack, updating CR3 register (TLB flush), and cache invalidation.
