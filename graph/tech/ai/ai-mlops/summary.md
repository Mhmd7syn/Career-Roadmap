# Model Serving, Evals & Observability

> **Structural Depth:** Depth $d=2$ | **Parent:** Track 3 AI Landscape

### Core Mental Models
1. **PagedAttention:** Manages KV cache memory like OS virtual memory paging, eliminating internal/external memory fragmentation.
2. **Quantization:** Reducing weights from FP16 $\to$ INT8 or INT4 (AWQ/GPTQ) for lower VRAM footprints.
3. **Tracing & Telemetry:** Monitoring token throughput, TTFT (time to first token), and output hallucination rates.
