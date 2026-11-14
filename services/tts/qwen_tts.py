from typing import List, Optional

import dashscope
import requests
from dashscope.audio import qwen_tts

from .base import TextToSpeechConverter


class QwenTTSTextToSpeechConverter(TextToSpeechConverter):
    def __init__(
        self,
        api_key: str,
        model: str,
        voices: List[str],
        folder: str,
        speed: float = 1.1,
        base_url: Optional[str] = None,
    ):
        self.api_key = api_key
        self.model = model
        if base_url:
            dashscope.base_http_api_url = base_url
        super().__init__(voices, folder, speed)

    async def generate_audio(self, content: str, voice: str, file_name: str):
        response = qwen_tts.SpeechSynthesizer.call(
            model=self.model,
            api_key=self.api_key,
            text=content,
            voice=voice,
        )
        if response is None or getattr(response, "output", None) is None:
            raise RuntimeError(
                f"TTS returned no audio (model={self.model}, voice={voice}): "
                f"{getattr(response, 'code', 'unknown')} - {getattr(response, 'message', response)}"
            )
        audio_url = response.output.audio["url"]

        response = requests.get(audio_url)
        response.raise_for_status()
        with open(file_name, "wb") as f:
            f.write(response.content)
