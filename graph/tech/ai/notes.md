# Track 3: AI Landscape

> **Track Focus:** Building, fine-tuning, evaluating, and serving machine learning, generative AI, and agentic workflows.

---

## Track Modules

1. **`ai-classical` (Classical Machine Learning & Modeling):** Scikit-Learn, XGBoost, LightGBM, cross-validation, precision/recall trade-offs.
2. **`ai-deeplearning` (Deep Learning & PyTorch Foundations):** Tensors, computational graphs, backpropagation, custom `nn.Module` loops.
3. **`ai-nlp-cv` (Transformers, NLP & Vision):** Self-attention mechanisms, Hugging Face transformers, BPE tokenization, embeddings.
4. **`ai-genai` (Generative AI, RAG & Agentic Systems):** Retrieval-Augmented Generation, vector similarity search, structured outputs, ReAct loops.
5. **`ai-mlops` (Model Serving, Evals & Observability):** vLLM high-throughput inference, Ollama, Langfuse tracing, Ragas evaluation benchmarks.

---

## Attention Mechanism Formula

$$\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V$$

```python
import torch
import torch.nn.functional as F

def scaled_dot_product_attention(Q, K, V):
    d_k = Q.size(-1)
    scores = torch.matmul(Q, K.transpose(-2, -1)) / (d_k ** 0.5)
    weights = F.softmax(scores, dim=-1)
    return torch.matmul(weights, V)
```
