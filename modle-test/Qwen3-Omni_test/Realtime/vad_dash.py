"""该测试代码展示了如何使用OpenAI Python SDK调用qwen3-omni-flash-realtime模型，进行实时语音对话。请确保已安装相关库，并正确配置了API Key。"""
# 依赖：dashscope >= 1.23.9，pyaudio
import os
import base64
import time
import pyaudio
from dashscope.audio.qwen_omni import MultiModality, AudioFormat,OmniRealtimeCallback,OmniRealtimeConversation
import dashscope

# 配置参数：地址、API Key、音色、模型、模型角色
# 指定地域，设为cn表示中国内地（北京），设为intl表示国际（新加坡）
region = 'cn'
base_domain = 'dashscope.aliyuncs.com' if region == 'cn' else 'dashscope-intl.aliyuncs.com'
url = f'wss://{base_domain}/api-ws/v1/realtime'
# 配置 API Key，若没有设置环境变量，请用 API Key 将下行替换为 dashscope.api_key = "sk-xxx"
dashscope.api_key = os.getenv('DASHSCOPE_API_KEY')
# 指定音色
voice = 'Cherry'
# 指定模型
model = 'qwen3-omni-flash-realtime'
# 指定模型角色
instructions = """ 
        你的设定：你是同学们的好朋友小Q，积极向上，品学兼优。
        你的聊天对象：在校大学生
        语言风格：
        1. 亲切友好：用温暖、关心、共情的语气与同学们交流，像朋友一样，避免说教。
        2. 回答简单明了，一次回复就说一件事，避免一次回复说太多内容。
        3. 适当采用一些主观说法，让回复更有温度和个性。
"""

class SimpleCallback(OmniRealtimeCallback):
    def __init__(self, pya):
        self.pya = pya
        self.out = None
    def on_open(self):
        # 初始化音频输出流
        self.out = self.pya.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=24000,
            output=True
        )
    def on_event(self, response):
        if response['type'] == 'response.audio.delta':
            # 播放音频
            self.out.write(base64.b64decode(response['delta']))
        elif response['type'] == 'conversation.item.input_audio_transcription.completed':
            # 打印转录文本
            print(f"[User] {response['transcript']}")
        elif response['type'] == 'response.audio_transcript.done':
            # 打印助手回复文本
            print(f"[LLM] {response['transcript']}")

# 1. 初始化音频设备
pya = pyaudio.PyAudio()
# 2. 创建回调函数和会话
callback = SimpleCallback(pya)
conv = OmniRealtimeConversation(model=model, callback=callback, url=url)
# 3. 建立连接并配置会话
conv.connect()
conv.update_session(output_modalities=[MultiModality.AUDIO, MultiModality.TEXT], voice=voice, instructions=instructions)
# 4. 初始化音频输入流
mic = pya.open(format=pyaudio.paInt16, channels=1, rate=16000, input=True)
# 5. 主循环处理音频输入
print("对话已开始，对着麦克风说话 (Ctrl+C 退出)...")
try:
    while True:
        audio_data = mic.read(3200, exception_on_overflow=False)
        conv.append_audio(base64.b64encode(audio_data).decode())
        time.sleep(0.01)
except KeyboardInterrupt:
    # 清理资源
    conv.close()
    mic.close()
    callback.out.close()
    pya.terminate()
    print("\n对话结束")