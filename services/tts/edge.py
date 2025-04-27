from typing import List

import edge_tts

from .base import TextToSpeechConverter


class EdgeTextToSpeechConverter(TextToSpeechConverter):
    def __init__(self, voices: List[str], folder: str, speed: float = 1.1):
        super().__init__(voices, folder, speed)

    async def generate_audio(self, content: str, voice: str, file_name: str):
        rate = f"+{int((self.speed - 1) * 100)}%"
        communicate = edge_tts.Communicate(content, voice, rate=rate)
        await communicate.save(file_name)
