"""Reproduce the committed browser artifact from the verified official PyPI wheel.

Developer-only: Python with onnxruntime==1.31.1 and NumPy. Not run by Vercel.
Download: python -m pip download --no-deps rapid-table==0.3.0
Run: python scripts/prepare-table-model.py rapid_table-0.3.0-py3-none-any.whl
"""
import argparse
import hashlib
from pathlib import Path
import tempfile
import zipfile
import numpy as np
import onnxruntime as ort

SOURCE_HASH='d57a942af6a2f57d6a4a0372573c696a2379bf5857c45e2ac69993f3b334514b'
TARGET_HASH='f1e8ae984d531e447bf2be66bf25ca318a12250ff06f88de9155bdcaaa95e117'

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('wheel',type=Path)
    parser.add_argument('--output',type=Path,default=Path('assets/models/table.onnx'))
    args=parser.parse_args()
    if ort.__version__!='1.31.1':raise SystemExit('Use onnxruntime==1.31.1 to reproduce the tested artifact.')
    with zipfile.ZipFile(args.wheel)as wheel:source=wheel.read('rapid_table/models/slanet-plus.onnx')
    if hashlib.sha256(source).hexdigest()!=SOURCE_HASH:raise SystemExit('Source checksum mismatch. Do not use this model.')
    with tempfile.TemporaryDirectory()as directory:
        original=Path(directory)/'original.onnx';converted=Path(directory)/'browser.onnx';original.write_bytes(source)
        options=ort.SessionOptions();options.intra_op_num_threads=1;options.log_severity_level=3
        options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_DISABLE_ALL;options.optimized_model_filepath=str(converted)
        reference=ort.InferenceSession(str(original),options,providers=['CPUExecutionProvider'])
        settings=ort.SessionOptions();settings.intra_op_num_threads=1;settings.log_severity_level=3
        settings.graph_optimization_level=ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        candidate=ort.InferenceSession(str(converted),settings,providers=['CPUExecutionProvider'])
        data=np.random.default_rng(1234).random((1,3,488,488),dtype=np.float32)
        for first,second in zip(reference.run(None,{'x':data}),candidate.run(None,{'x':data})):
            np.testing.assert_allclose(first,second,rtol=1e-5,atol=1e-6)
        result=converted.read_bytes()
        if hashlib.sha256(result).hexdigest()!=TARGET_HASH:raise SystemExit('Numerical checks passed but serialization differs. Inspect before replacing the pinned artifact.')
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_bytes(result)
    print('Source verified, predictions equivalent, browser artifact checksum verified.')
