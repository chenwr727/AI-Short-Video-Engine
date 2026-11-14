import json
import os
import re
import toml
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from api.schemas import TaskCreate
from schemas.config import MaterialSource, TTSSource
from schemas.video import MaterialInfo, VideoTranscript
from services.llm import LLmWriter
from utils.config import config, get_prompt_config
from utils.log import logger
from utils.text import split_content_with_punctuation
from utils.url import get_content, parse_url
from utils.video import create_video


@dataclass
class ProcessingFiles:
    """Class to manage file paths for video processing."""

    folder: str

    def __post_init__(self):
        """Initialize all file paths after instance creation."""
        self.script = os.path.join(self.folder, "_transcript.json")
        self.html = os.path.join(self.folder, "_html.txt")
        self.draft = os.path.join(self.folder, "_transcript.txt")
        self.durations = os.path.join(self.folder, "_durations.json")
        self.videos = os.path.join(self.folder, "_videos.json")
        self.terms = os.path.join(self.folder, "_terms.json")
        self.output = os.path.join(self.folder, "_output.mp4")


class VideoGenerator:
    def __init__(self):
        self.config = config
        self.assistant = LLmWriter(config.llm.api_key, config.llm.base_url, config.llm.model)

    async def _get_content_from_source(self, url: str, files: ProcessingFiles) -> Optional[str]:
        """Fetch or read content from URL or direct text."""
        logger.info("Starting to fetch content")
        if os.path.exists(files.html):
            logger.info("Content file already exists, reading from file")
            return self._read_file(files.html)

        if url.startswith("http"):
            logger.info("Starting to fetch content from URL")
            content = await get_content(url)
            if not content:
                logger.error("Failed to fetch content from URL")
                return None
        else:
            content = url

        self._write_file(files.html, content)
        return content

    async def _generate_transcript(self, content: str, files: ProcessingFiles) -> Optional[str]:
        """Generate first transcript."""
        logger.info("Starting to generate transcrip")
        if os.path.exists(files.draft):
            logger.info("transcript file already exists")
            return self._read_file(files.draft)

        text_writer = await self.assistant.writer(content, self.config.prompt.prompt_writer)
        if text_writer:
            self._write_file(files.draft, text_writer)
            return text_writer
        return None

    async def _generate_final_transcript(self, transcript: str) -> Optional[Dict[str, Any]]:
        """Generate final video transcript."""
        logger.info("Starting to generate final transcript")
        text_rewriter = await self.assistant.writer(
            transcript,
            self.config.prompt.prompt_rewriter,
            response_format={"type": "json_object"},
        )
        if not text_rewriter:
            return None

        json_match = re.search(r"(\{.*\s?\})", text_rewriter, re.DOTALL)
        if not json_match:
            logger.error("No JSON object found in response")
            return None

        return json.loads(json_match.group(1))

    async def _convert_to_transcript(
        self, transcript_data: Dict[str, str | List[Dict[str, str | List[Dict[str, str]]]]]
    ) -> VideoTranscript:
        """Convert transcript data to VideoTranscript"""
        for paragraph in transcript_data["paragraphs"]:
            for dialogue in paragraph["dialogues"]:
                content = dialogue.pop("content")
                dialogue["contents"] = split_content_with_punctuation(content)
                # default: tts text = display text (will be regenerated with tags for qwen_audio)
                dialogue["contents_tts"] = list(dialogue["contents"])
        video_transcript = VideoTranscript.model_validate(transcript_data)
        return video_transcript

    async def _generate_tts_tags(self, video_transcript: VideoTranscript, files: ProcessingFiles) -> None:
        """Ask the LLM to produce tagged TTS text (content_tts) for every dialogue.

        Only meaningful for models that support emotion / rich-language tags
        (qwen-audio-3.0-tts). Display text (`contents`) stays clean for subtitles
        and search terms; TTS synthesis uses `contents_tts`.

        The generated content_tts is written back to the transcript JSON so it is
        persisted and can be inspected / reused on re-runs.
        """
        logger.info("Starting to generate TTS tags via LLM")
        try:
            with open("./prompts/tts_tags.toml", "r", encoding="utf-8") as f:
                tag_prompt = toml.load(f)["prompt_tts_tags"]
        except Exception as e:
            logger.error(f"Failed to load tts_tags prompt: {e}")
            return

        for paragraph in video_transcript.paragraphs:
            # collect contents of every dialogue in this paragraph
            items = []
            flat = []
            for dialogue in paragraph.dialogues:
                for i, content in enumerate(dialogue.contents):
                    items.append({"id": len(items) + 1, "content": content})
                    flat.append((dialogue, i))

            if not items:
                continue

            tagged = await self.assistant.writer(
                json.dumps(items, ensure_ascii=False),
                tag_prompt,
                response_format={"type": "json_object"},
            )
            if not tagged:
                logger.warning("TTS tags generation returned nothing, keep original text")
                continue

            json_match = re.search(r"(\[.*\s?\])", tagged, re.DOTALL)
            if not json_match:
                logger.warning("No valid JSON array found in TTS tags response, keep original text")
                continue
            try:
                results = json.loads(json_match.group(1))
            except Exception as e:
                logger.warning(f"Failed to parse TTS tags JSON: {e}")
                continue

            for entry in results:
                cid = entry.get("id")
                content_tts = entry.get("content_tts")
                if cid is None or content_tts is None:
                    continue
                idx = cid - 1
                if 0 <= idx < len(flat):
                    dialogue, i = flat[idx]
                    dialogue.contents_tts[i] = content_tts

        # persist content_tts back into the transcript JSON file
        try:
            self._persist_content_tts(video_transcript, files)
        except Exception as e:
            logger.warning(f"Failed to persist content_tts to transcript: {e}")

    def _persist_content_tts(self, video_transcript: VideoTranscript, files: ProcessingFiles) -> None:
        """Merge in-memory contents_tts (split + tagged) back into the transcript JSON."""
        if not os.path.exists(files.script):
            logger.warning("Transcript file not found; cannot persist content_tts")
            return
        with open(files.script, "r", encoding="utf-8") as f:
            data = json.load(f)

        # index dialogues by (paragraph_idx, dialogue_idx) to match with in-memory order
        for pi, paragraph in enumerate(video_transcript.paragraphs):
            for di, dialogue in enumerate(paragraph.dialogues):
                if pi < len(data.get("paragraphs", [])) and di < len(data["paragraphs"][pi].get("dialogues", [])):
                    if dialogue.contents_tts:
                        data["paragraphs"][pi]["dialogues"][di]["content_tts"] = "".join(dialogue.contents_tts)

        self._write_json(files.script, data)
        logger.info("content_tts persisted to transcript JSON")

    async def _process_audio(
        self, video_transcript: VideoTranscript, files: ProcessingFiles, tts_source: Optional[str] = None
    ) -> List[float]:
        """Process audio for the video."""
        logger.info("Starting to process audio")
        tts_source = tts_source or self.config.tts.source
        # Always (re)generate content_tts for qwen_audio before any cache short-circuit,
        # so tags are produced even on re-runs / when durations already exist.
        if tts_source == TTSSource.qwen_audio:
            await self._generate_tts_tags(video_transcript, files)

        if os.path.exists(files.durations):
            return json.loads(self._read_file(files.durations))
        if tts_source == TTSSource.cosyvoice:
            from services.tts import CosyvoiceTextToSpeechConverter

            converter = CosyvoiceTextToSpeechConverter(
                self.config.tts.cosyvoice.api_key,
                self.config.tts.cosyvoice.model,
                self.config.tts.cosyvoice.voices,
                files.folder,
                self.config.tts.cosyvoice.speed,
                self.config.tts.cosyvoice.base_url,
            )
        elif tts_source == TTSSource.qwen_tts:
            from services.tts import QwenTTSTextToSpeechConverter

            converter = QwenTTSTextToSpeechConverter(
                self.config.tts.qwen_tts.api_key,
                self.config.tts.qwen_tts.model,
                self.config.tts.qwen_tts.voices,
                files.folder,
                self.config.tts.qwen_tts.speed,
                self.config.tts.qwen_tts.base_url,
            )
        elif tts_source == TTSSource.qwen_audio:
            from services.tts import QwenAudioTextToSpeechConverter

            converter = QwenAudioTextToSpeechConverter(
                self.config.tts.qwen_audio.api_key,
                self.config.tts.qwen_audio.model,
                self.config.tts.qwen_audio.voices,
                files.folder,
                self.config.tts.qwen_audio.speed,
                self.config.tts.qwen_audio.base_url,
            )
        else:
            raise ValueError("Invalid TTS source")
        durations = await converter.text_to_speech(video_transcript.paragraphs)
        self._write_json(files.durations, durations)
        return durations

    async def _process_videos(
        self,
        video_transcript: VideoTranscript,
        durations: List[float],
        files: ProcessingFiles,
        material_source: Optional[str] = None,
    ) -> List[MaterialInfo]:
        """Process videos for the final output."""
        logger.info("Starting to process videos")
        if os.path.exists(files.videos):
            datas = json.loads(self._read_file(files.videos))
            return [MaterialInfo.model_validate(data) for data in datas]

        search_terms = await self._get_search_terms(video_transcript, files)

        # collect per-paragraph dialogue text so the AI can match video semantics
        contents_list: List[str] = []
        for paragraph in video_transcript.paragraphs:
            paragraph_text = "\n".join(line for d in paragraph.dialogues for line in d.contents)
            contents_list.append(paragraph_text)

        # optional vision model for visual video re-ranking (uses its own client)
        vision_writer = None
        vision_model = ""
        if self.config.vision and self.config.vision.enable and self.config.vision.model:
            vision_writer = LLmWriter(
                self.config.vision.api_key,
                self.config.vision.base_url,
                self.config.vision.model,
            )
            vision_model = self.config.vision.model

        material_source = material_source or self.config.material.source
        if material_source == MaterialSource.pexels:
            from services.material import PexelsHelper

            material_helper = PexelsHelper(
                self.config.material.pexels.api_key,
                self.config.material.pexels.locale,
                self.config.material.minimum_duration,
                self.config.video.width,
                self.config.video.height,
                llm_writer=self.assistant,
                vision_writer=vision_writer,
                vision_model=vision_model,
            )
        elif material_source == MaterialSource.pixabay:
            from services.material import PixabayHelper

            material_helper = PixabayHelper(
                self.config.material.pixabay.api_key,
                self.config.material.pixabay.lang,
                self.config.material.pixabay.video_type,
                self.config.material.minimum_duration,
                self.config.video.width,
                self.config.video.height,
                llm_writer=self.assistant,
                vision_writer=vision_writer,
                vision_model=vision_model,
            )
        else:
            raise ValueError("Invalid material source")
        videos = await material_helper.get_videos(durations, search_terms, contents_list)
        self._write_json(files.videos, [video.model_dump() for video in videos])
        return videos

    async def _get_search_terms(
        self, video_transcript: VideoTranscript, files: ProcessingFiles, max_retries: int = 3
    ) -> List[str]:
        """Get search terms for video content."""
        logger.info("Starting to get search terms")
        if os.path.exists(files.terms):
            return json.loads(self._read_file(files.terms))

        content_list = []
        i = 0
        for paragraph in video_transcript.paragraphs:
            dialogues = paragraph.dialogues
            contents = []
            for dialogue in dialogues:
                contents.extend(dialogue.contents)
            content_list.append({"id": i + 1, "content": "\n".join(contents)})

        for i in range(max_retries):
            logger.debug(f"Trying to get search terms {i+1}/{max_retries}")
            content = await self.assistant.writer(
                str(content_list), self.config.material.prompt, response_format={"type": "json_object"}
            )
            json_match = re.search(r"(\[.*\s?\])", content, re.DOTALL)
            if not json_match:
                logger.warning("No valid JSON found in search terms response")
                continue
            results = json.loads(json_match.group(1))
            if len(results) != len(content_list):
                logger.warning("Number of search terms does not match number of dialogues")
                continue
            try:
                search_terms = [result["search_terms"] for result in results]
                break
            except KeyError:
                logger.warning("Invalid search terms response")
                continue
        else:
            raise ValueError("Number of search terms does not match number of dialogues")
        self._write_json(files.terms, search_terms)
        return search_terms

    @staticmethod
    def _read_file(filepath: str) -> str:
        """Read content from a file."""
        with open(filepath, "r", encoding="utf-8") as f:
            return f.read()

    @staticmethod
    def _write_file(filepath: str, content: str) -> None:
        """Write content to a file."""
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)

    @staticmethod
    def _write_json(filepath: str, content: Any) -> None:
        """Write JSON content to a file."""
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(content, f, ensure_ascii=False, indent=4)

    async def generate_video(self, task_create: TaskCreate, doc_id: Optional[int] = None) -> Optional[str]:
        """Main method to generate video from URL or text content."""
        try:
            url = task_create.name
            logger.info(f"Starting video generation for {url}")
            folder = parse_url(url, doc_id)
            files = ProcessingFiles(folder)

            # Early return if output already exists
            if os.path.exists(files.output):
                logger.info("Output video already exists")
                return files.output

            # Process content and generate transcript if not cached
            if not os.path.exists(files.script):
                self.config.prompt = get_prompt_config(task_create.prompt_source)

                content = await self._get_content_from_source(url, files)
                if not content:
                    raise ValueError("Failed to fetch content from source")

                transcript = await self._generate_transcript(content, files)
                if not transcript:
                    raise ValueError("Failed to generate transcript")

                final_transcript = await self._generate_final_transcript(transcript)
                if not final_transcript:
                    raise ValueError("Failed to generate final transcript")

                self._write_json(files.script, final_transcript)
                logger.info("Video script generation completed")

            # Load transcript and process
            transcript_data = json.loads(self._read_file(files.script))
            video_transcript = await self._convert_to_transcript(transcript_data)

            # Generate audio and video
            durations = await self._process_audio(video_transcript, files, task_create.tts_source)
            videos = await self._process_videos(video_transcript, durations, files, task_create.material_source)

            # Create final video
            await create_video(videos, video_transcript, files.folder, files.output, self.config.video)

            return files.output if os.path.exists(files.output) else None

        except Exception as e:
            logger.error(f"Error in video generation: {str(e)}")
            raise e
