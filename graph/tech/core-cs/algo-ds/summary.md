# Algorithms & Data Structures

> **Structural Depth:** Depth $d=2$ | **Parent:** Track 0 Core CS

### Core Mental Models
1. **Asymptotic Growth:** Differentiating $\mathcal{O}(1)$, $\mathcal{O}(\log N)$, $\mathcal{O}(N)$, $\mathcal{O}(N \log N)$, and $\mathcal{O}(N^2)$.
2. **Contiguous Memory vs Pointer Nodes:** Cache locality favors arrays; linked structures cause CPU cache misses.
3. **Hash Collisions:** Open addressing vs chaining; amortized $\mathcal{O}(1)$ lookups.

### Code Demonstration: BFS Graph Traversal
```python
from collections import deque

def bfs(graph: dict[str, list[str]], start: str) -> list[str]:
    visited = {start}
    queue = deque([start])
    order = []
    
    while queue:
        node = queue.popleft()
        order.append(node)
        for neighbor in graph.get(node, []):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
    return order
```

### Active Recall Challenge
- *What happens to hash table lookup performance when the load factor $\alpha = N / \text{buckets}$ exceeds 0.75?*
