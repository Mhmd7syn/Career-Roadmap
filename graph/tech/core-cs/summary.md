# Track 0: Core CS Foundations

> **Track Focus:** Low-level fundamentals that govern performance, concurrency, network latency, and code elegance.

---

## Track Modules

1. **`algo-ds` (Algorithms & Data Structures):** Asymptotic analysis $\mathcal{O}(N)$, arrays, hash tables, trees, heaps, graphs, dynamic programming.
2. **`systems-os` (Operating Systems & Concurrency):** Processes, threads, virtual memory, context switches, Linux system calls, POSIX concurrency.
3. **`networking` (Computer Networking & Protocols):** TCP/IP 4-layer model, handshake overhead, TLS 1.3, HTTP/2 multiplexing, HTTP/3 QUIC, WebSockets.
4. **`craftsmanship` (Software Craftsmanship & Tooling):** Clean code, refactoring patterns, Git DAG manipulation, automated unit and regression testing.

---

## Mathematical Anchor: Time & Space Complexity

$$\mathcal{O}(1) < \mathcal{O}(\log N) < \mathcal{O}(N) < \mathcal{O}(N \log N) < \mathcal{O}(N^2) < \mathcal{O}(2^N)$$

```python
# Array traversal: O(N) time with cache-friendly contiguous memory
def linear_search(arr: list[int], target: int) -> int:
    for i, val in enumerate(arr):
        if val == target:
            return i
    return -1
```
