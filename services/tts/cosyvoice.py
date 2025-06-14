from typing import List

import dashscope
from dashscope.audio.tts_v2 import SpeechSynthesizer

from .base import TextToSpeechConverter


class CosyvoiceTextToSpeechConverter(TextToSpeechConverter):
    def __init__(self, api_key: str, model: str, voices: List[str], folder: str, speed: float = 1.1):
        self.api_key = api_key
        self.model = model
        dashscope.api_key = self.api_key
        super().__init__(voices, folder, speed)

    async def generate_audio(self, content: str, voice: str, file_name: str):
        synthesizer = SpeechSynthesizer(model=self.model, voice=voice, speech_rate=self.speed)
        audio = synthesizer.call(content)
        with open(file_name, "wb") as f:
            f.write(audio)
