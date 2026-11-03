# Deep Learning & PyTorch Foundations

> **Structural Depth:** Depth $d=2$ | **Parent:** Track 3 AI Landscape

### Core Mental Models
1. **Autograd Engine:** Traces operations on tensors dynamically to construct reverse execution graphs for gradient computation via chain rule.
2. **Optimizer Updates:** AdamW decouples weight decay from gradient updates: $\theta_{t+1} = \theta_t - \eta \cdot \left(\frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon} + \lambda \theta_t\right)$.
3. **Training Loop Hygiene:** `model.train()` vs `model.eval()`, zeroing gradients, validation loss checkpoints.
