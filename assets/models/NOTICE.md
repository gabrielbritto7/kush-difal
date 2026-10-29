# SLANet-plus

Model and reference preprocessing/postprocessing: PaddleOCR / PaddlePaddle Authors and RapidAI/RapidTable contributors, Apache License 2.0. See LICENSE-APACHE-2.0.txt and manifest.json.

The original model is embedded in the official `rapid-table==0.3.0` PyPI wheel. Its SHA-256 matches the upstream RapidTable model manifest. The browser artifact was re-serialized with ONNX Runtime 1.31.1 and graph optimizations disabled to reconcile inconsistent exported shape metadata rejected by the Web runtime. No training, checksum bypass or replacement of learned values is performed.

`scripts/prepare-table-model.py` verifies the original hash, compares predictions of original and converted models and verifies the committed browser artifact's hash. The static build verifies that derived hash again. Python is not required for deployment.

This model recognizes cell boundaries and table structure. It does not infer tax law, NCM or missing prices. OCR/PDF text is matched to the cells; amounts are validated separately.
