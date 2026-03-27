# Face + Emotion Backend Module

该目录已内置你在 `gui_app2.py` 的核心能力后端化版本：

- 人脸检测：`MTCNN`
- 人脸特征：`InceptionResnetV1(vggface2)`
- 表情识别：`EmotiEffLibRecognizer(enet_b0_8_best_vgaf)`

## 主要文件

- `face_engine.py`：人脸识别与情绪识别引擎
- `app.py`：新增 `/api/face/*` 接口
- `database.py`：新增 `student`、`emotion_record` 两张表及逻辑删除字段

## 说明

首次调用识别接口时，会自动加载模型（首次会稍慢）。
