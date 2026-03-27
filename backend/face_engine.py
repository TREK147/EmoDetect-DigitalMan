import base64
import json
import threading
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch
from facenet_pytorch import InceptionResnetV1, MTCNN
from emotiefflib.facial_analysis import EmotiEffLibRecognizer


@dataclass
class DetectionResult:
    student_id: str
    emotion: str
    confidence: float
    box: List[int]


class FaceEmotionEngine:
    """后端人脸识别 + 情绪识别引擎（延续 gui_app2.py 的主流程）。"""

    def __init__(self) -> None:
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.mtcnn = MTCNN(keep_all=True, device=self.device)
        self.face_model = InceptionResnetV1(pretrained="vggface2").eval().to(self.device)
        self.emotion_model = EmotiEffLibRecognizer(
            engine="torch",
            model_name="enet_b0_8_best_vgaf",
            device=self.device,
        )
        self._lock = threading.Lock()

    @staticmethod
    def decode_base64_image(image_base64: str) -> Optional[np.ndarray]:
        if not image_base64:
            return None
        raw = image_base64.strip()
        if "," in raw and raw.startswith("data:"):
            raw = raw.split(",", 1)[-1]
        try:
            img_bytes = base64.b64decode(raw)
            arr = np.frombuffer(img_bytes, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            return frame
        except Exception:
            return None

    @staticmethod
    def _match_face(embedding: np.ndarray, face_db: Dict[str, np.ndarray], threshold: float = 0.6) -> str:
        best_id = "unknown"
        min_dist = float("inf")
        for sid, db_emb in face_db.items():
            dist = np.linalg.norm(embedding - db_emb)
            if dist < min_dist:
                min_dist = dist
                best_id = sid
        return best_id if min_dist < threshold else "unknown"

    def extract_embedding(self, frame: np.ndarray) -> Optional[np.ndarray]:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        with self._lock:
            face = self.mtcnn(rgb)
            if face is None:
                return None
            emb = self.face_model(face.unsqueeze(0).to(self.device)).detach().cpu().numpy()[0]
            return emb

    def detect(self, frame: np.ndarray, face_db: Dict[str, np.ndarray], threshold: float = 0.6) -> List[DetectionResult]:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        with self._lock:
            boxes, _ = self.mtcnn.detect(rgb)
            if boxes is None:
                return []
            faces = self.mtcnn(rgb)
            if faces is None:
                return []

            imgs = []
            for f in faces:
                img = f.permute(1, 2, 0).cpu().numpy()
                img = (img * 128 + 127.5).clip(0, 255).astype(np.uint8)
                imgs.append(img)

            emotions, confs = self.emotion_model.predict_emotions(imgs, logits=True)

            results: List[DetectionResult] = []
            for i, face in enumerate(faces):
                emb = self.face_model(face.unsqueeze(0).to(self.device)).detach().cpu().numpy()[0]
                sid = self._match_face(emb, face_db, threshold=threshold)
                emo = emotions[i]
                conf = round(float(np.max(confs[i])), 2)
                x1, y1, x2, y2 = [int(v) for v in boxes[i]]
                results.append(
                    DetectionResult(
                        student_id=sid,
                        emotion=emo,
                        confidence=conf,
                        box=[x1, y1, x2, y2],
                    )
                )
            return results


_ENGINE: Optional[FaceEmotionEngine] = None
_ENGINE_LOCK = threading.Lock()


def get_engine() -> FaceEmotionEngine:
    global _ENGINE
    with _ENGINE_LOCK:
        if _ENGINE is None:
            _ENGINE = FaceEmotionEngine()
        return _ENGINE
