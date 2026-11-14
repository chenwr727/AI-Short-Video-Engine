from typing import List

import dashscope
from dashscope.audio.tts_v2 import SpeechSynthesizer

from .base import TextToSpeechConverter


class CosyvoiceTextToSpeechConverter(TextToSpeechConverter):

    def __init__(self, api_key: str, model: str, voices: List[str], folder: str, speed: float = 1.1, base_url: str = None):
        self.api_key = api_key
        self.model = model
        dashscope.api_key = self.api_key
        if base_url:
            dashscope.base_http_api_url = base_url
        super().__init__(voices, folder, speed)

    async def generate_audio(self, content: str, voice: str, file_name: str):
        synthesizer = SpeechSynthesizer(model=self.model, voice=voice, speech_rate=self.speed)
        audio = synthesizer.call(content)
        if not audio:
            response = getattr(synthesizer, "_last_response", None) or {}
            header = response.get("header", {}) if isinstance(response, dict) else {}
            raise RuntimeError(
                f"TTS returned no audio (model={self.model}, voice={voice}): "
                f"{header.get('error_code', 'unknown')} - {header.get('error_message', response)}"
            )
        with open(file_name, "wb") as f:
            f.write(audio)
