window.RoadmapRegistry = window.RoadmapRegistry || {};

window.RoadmapRegistry['ai'] = {
  id: 'ai',
  title: 'Track 3: AI Landscape',
  parentRoadmapId: 'tech',
  description: 'Classical machine learning, deep learning, NLP, computer vision, modern GenAI/LLMs, and MLOps.',
  stations: [
    {
      id: 'ai-classical',
      title: 'Classical Machine Learning & Modeling',
      badge: 'AI-01',
      description: 'Scikit-Learn, regression, classification, tree ensembles (XGBoost/LightGBM), and evaluation metrics.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Bias-variance trade-off, train/val/test splits, ROC-AUC, F1-score, precision/recall.' },
        { level: 2, title: 'Applied', goal: 'Build an end-to-end tabular prediction pipeline with cross-validation and hyperparameter tuning.' },
        { level: 3, title: 'Deep Dive', goal: 'Mathematical foundations of gradient boosting, loss functions, and calibration.' }
      ],
      resources: [
        { label: 'Scikit-Learn User Guide & Tutorials', url: 'https://scikit-learn.org/stable/user_guide.html' }
      ],
      concept: 'Before deploying billion-parameter models, classical ML offers fast, interpretable, cost-effective baselines.',
      activeRecall: 'When would you prioritize optimizing Precision over Recall in an engineering application?'
    },
    {
      id: 'ai-deeplearning',
      title: 'Deep Learning & PyTorch Foundations',
      badge: 'AI-02',
      description: 'Tensors, computational graphs, autograd, forward/backward loops, and custom architectures.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Perceptrons, activation functions (ReLU, GELU), backpropagation, optimizer algorithms (AdamW).' },
        { level: 2, title: 'Applied', goal: 'Write clean PyTorch custom training loop with DataLoader and validation loss tracking.' },
        { level: 3, title: 'Deep Dive', goal: 'Mixed precision training (FP16/BF16), GPU memory profiling, custom autograd Functions.' }
      ],
      resources: [
        { label: 'DeepLearning.AI: Deep Learning Specialization (Coursera)', url: 'https://www.coursera.org/specializations/deep-learning' }
      ],
      concept: 'PyTorch is the foundational language of modern AI research and production model training.',
      activeRecall: 'Explain the role of the computational graph and how autograd calculates gradients backwards.'
    },
    {
      id: 'ai-nlp-cv',
      title: 'Transformers, NLP & Vision Architectures',
      badge: 'AI-03',
      description: 'Self-attention mechanism, multi-head attention, Hugging Face ecosystem, and tokenization.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Self-attention formula (Q, K, V), encoder vs decoder architectures, BPE tokenization.' },
        { level: 2, title: 'Applied', goal: 'Load and run open-source models with Hugging Face `transformers` pipeline and generate embeddings.' },
        { level: 3, title: 'Deep Dive', goal: 'FlashAttention mechanics, KV cache memory footprint, positional embeddings (RoPE).' }
      ],
      resources: [
        { label: 'The Illustrated Transformer (Jay Alammar)', url: 'https://jalammar.github.io/illustrated-transformer/' }
      ],
      concept: 'Transformers replaced sequential RNNs by computing attention across all input tokens in parallel.',
      activeRecall: 'What is the physical intuition behind Queries, Keys, and Values in the scaled dot-product attention formula?'
    },
    {
      id: 'ai-genai',
      title: 'Generative AI, RAG & Agentic Systems',
      badge: 'AI-04',
      description: 'Prompt engineering, structured outputs, Vector DBs (pgvector/Qdrant), RAG, and Agent loops.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'In-context learning, chunking strategies, vector similarity (cosine), ReAct agent pattern.' },
        { level: 2, title: 'Applied', goal: 'Build an end-to-end RAG system with pgvector and function-calling tool use.' },
        { level: 3, title: 'Deep Dive', goal: 'Hybrid search (BM25 + Dense vectors), cross-encoder re-ranking, multi-agent orchestration.' }
      ],
      resources: [
        { label: 'DeepLearning.AI Short Courses on RAG & Agents (Free)', url: 'https://www.deeplearning.ai/short-courses/' }
      ],
      concept: 'RAG grounds non-deterministic LLMs in factual private enterprise data without expensive re-training.',
      activeRecall: 'What are the main failure modes of naïve RAG (chunk size, retrieval precision, lost in the middle)?'
    },
    {
      id: 'ai-mlops',
      title: 'Model Serving, Evals & Observability',
      badge: 'AI-05',
      description: 'vLLM, Ollama, quantization (GGUF/AWQ), Langfuse tracing, and Ragas evaluation frameworks.',
      type: 'topic',
      depthStages: [
        { level: 1, title: 'Survey', goal: 'Inference throughput vs latency, PagedAttention, telemetry tracing, hallucination metrics.' },
        { level: 2, title: 'Applied', goal: 'Deploy a local model with vLLM/Ollama and set up Langfuse tracing on LLM calls.' },
        { level: 3, title: 'Deep Dive', goal: 'Quantization trade-offs (INT4 vs FP8), automated synthetic evaluation pipelines with Ragas.' }
      ],
      resources: [
        { label: 'vLLM High-Throughput Serving Documentation', url: 'https://docs.vllm.ai/' },
        { label: 'Langfuse Open Source LLM Observability', url: 'https://langfuse.com/' }
      ],
      concept: 'You cannot improve what you cannot measure; production AI demands rigorous continuous evaluation and latency tracing.',
      activeRecall: 'How does PagedAttention eliminate memory fragmentation in multi-request LLM serving?'
    }
  ]
};
