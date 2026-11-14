import asyncio
import hashlib
import os
from abc import ABC, abstractmethod
from typing import List, Optional

import aiohttp
from fake_useragent import UserAgent
from moviepy import VideoFileClip

from schemas.video import MaterialInfo
from utils.log import logger


class MaterialHelper(ABC):
    def __init__(
        self,
        api_key: str,
        minimum_duration: int,
        video_width: int,
        video_height: int,
        max_page: int = 3,
        llm_writer=None,
        vision_writer=None,
        vision_model: str = "",
    ):
        self.api_key = api_key
        self.minimum_duration = minimum_duration
        self.video_width = video_width
        self.video_height = video_height
        self.max_page = max_page
        self.llm_writer = llm_writer
        self.vision_writer = vision_writer
        self.vision_model = vision_model
        self.headers = {"User-Agent": UserAgent().random}

    async def _ai_select(self, content: str, candidates: List[MaterialInfo]) -> Optional[MaterialInfo]:
        """Two-stage selection: text-based top-3, then (optionally) visual re-rank.

        Returns None on any failure so the caller falls back to rule-based logic.
        """
        if not self.llm_writer or not candidates:
            return None
        try:
            import json
            import toml

            with open("./prompts/video_select.toml", "r", encoding="utf-8") as f:
                prompt = toml.load(f)["prompt_video_select"]

            payload = {
                "content": content,
                "candidates": [
                    {
                        "id": v.id,
                        "tags": v.tags,
                        "duration": v.duration,
                        "views": v.views,
                        "is_ai_generated": v.is_ai_generated,
                    }
                    for v in candidates
                ],
            }
            resp = await self.llm_writer.writer(
                json.dumps(payload, ensure_ascii=False),
                prompt,
                response_format={"type": "json_object"},
            )
            if not resp:
                return None
            import re

            m = re.search(r"\{.*\}", resp, re.DOTALL)
            if not m:
                return None
            result = json.loads(m.group(0))
            selected_ids = result.get("selected_ids") or result.get("selected_id")
            if not selected_ids:
                return None
            if isinstance(selected_ids, int):
                selected_ids = [selected_ids]
            top = []
            for sid in selected_ids:
                for v in candidates:
                    if v.id == sid and v not in top:
                        top.append(v)
            if not top:
                return None

            # stage 2: visual re-rank on the top few thumbnails (if available)
            visual_pick = await self._visual_rerank(content, top)
            if visual_pick:
                return visual_pick
            return top[0]
        except Exception as e:
            logger.warning(f"AI video selection failed, falling back: {e}")
        return None

    async def _visual_rerank(self, content: str, top: List[MaterialInfo]) -> Optional[MaterialInfo]:
        """Look at the thumbnails of the top candidates and pick the best visual match.

        Returns None when the vision model is unavailable or fails, so selection
        falls back to the text-based top pick.
        """
        if not self.vision_writer or not self.vision_model:
            return None
        candidates_with_img = [v for v in top if v.image_url]
        if not candidates_with_img:
            return None
        try:
            best = None
            best_reason = ""
            for v in candidates_with_img:
                question = (
                    f"这段对话内容：{content}\n"
                    f"候选视频标签：{v.tags}\n"
                    f"这个视频的封面画面是否与上述对话内容契合？只回答 yes 或 no，并给出简短理由。"
                )
                answer = await self.vision_writer.vision_writer(v.image_url, question)
                if answer and "yes" in answer.lower():
                    # first visual "yes" wins; could compare reasons but this is enough
                    if best is None:
                        best = v
                        best_reason = answer
            if best:
                logger.info(f"Visual pick: id={best.id} reason={best_reason[:80]}")
                return best
        except Exception as e:
            logger.warning(f"Visual rerank failed, falling back to text pick: {e}")
        return None

    def _find_closest_video(
        self, video_items: List[MaterialInfo], audio_length: float, urls: set[str]
    ) -> Optional[MaterialInfo]:
        """Pick the video whose duration best fits the audio segment.

        Videos SHORTER than the audio are never selected — a too-short clip would
        end before the dialogue finishes (frozen/black frame). Preference order:
          1. duration in [audio_length, audio_length * 1.5] — closest to audio length
          2. any video at least as long as audio — the shortest one
        Returns None when nothing is long enough so the caller can move on.
        """
        candidates = [v for v in video_items if v.url not in urls and v.duration >= audio_length]
        if not candidates:
            return None

        # 1) best fit: within [audio, audio*1.5], closest to audio
        best_fit = None
        best_diff = float("inf")
        for v in candidates:
            if v.duration <= audio_length * 1.5:
                diff = abs(v.duration - audio_length)
                if diff < best_diff:
                    best_diff = diff
                    best_fit = v
        if best_fit:
            return best_fit

        # 2) at least as long as audio: shortest among them
        return min(candidates, key=lambda v: v.duration)

    @abstractmethod
    def _filter_video_items(self, videos: List[dict]) -> List[MaterialInfo]:
        pass

    @abstractmethod
    async def search_videos(self, search_term: str, page: int) -> List[MaterialInfo]:
        pass

    async def get_videos(
        self,
        audio_lengths: List[float],
        search_terms_list: List[List[str]],
        contents_list: Optional[List[str]] = None,
    ) -> List[MaterialInfo]:
        urls = set()
        videos: List[MaterialInfo] = []

        for i, (search_terms, audio_length) in enumerate(zip(search_terms_list, audio_lengths)):
            content = contents_list[i] if contents_list and i < len(contents_list) else ""
            video = await self._select_video(search_terms, audio_length, urls, content)
            urls.add(video.url)
            videos.append(video)

        # download all selected videos (cached by URL)
        for video in videos:
            video_path = await self.save_video(video.url)
            if video_path:
                video.video_path = video_path
            else:
                raise ValueError("Video has no path")
        return videos

    async def _select_video(
        self, search_terms: List[str], audio_length: float, urls: set[str], content: str = ""
    ) -> MaterialInfo:
        """Try every search term (across pages), then pick the best matching video.

        If an LLM writer is available, prefer its semantic match over the rule-based
        heuristic. Falls back to `_find_closest_video` on any failure so a single
        poor result does not abort the task.
        """
        candidates: List[MaterialInfo] = []
        for search_term in search_terms:
            for page in range(1, self.max_page + 1):
                logger.info(f"Searching videos for '{search_term}' (page {page})")
                try:
                    items = await self.search_videos(search_term, page)
                except Exception as e:
                    logger.error(f"search_videos failed for '{search_term}': {e}")
                    items = []
                candidates.extend(items)
                await asyncio.sleep(1)

        # de-duplicate by url and exclude already-used videos
        seen = set()
        fresh_candidates: List[MaterialInfo] = []
        for v in candidates:
            if v.url not in urls and v.url not in seen:
                seen.add(v.url)
                fresh_candidates.append(v)

        if not fresh_candidates:
            raise ValueError("No video found for search terms")

        # 1) AI semantic selection (if available) — but never pick a clip shorter
        #    than the audio, otherwise the frame ends before the dialogue.
        ai_pick = await self._ai_select(content, fresh_candidates)
        if ai_pick and ai_pick.duration >= audio_length:
            return ai_pick

        # 2) rule-based fallback (only ever returns clips >= audio_length)
        picked = self._find_closest_video(fresh_candidates, audio_length, set())
        if picked:
            return picked

        raise ValueError("No video found for search terms")

    async def save_video(self, video_url: str, save_dir: str = "./cache_videos") -> str:
        if not os.path.exists(save_dir):
            os.makedirs(save_dir)

        url_without_query = video_url.split("?")[0]
        url_hash = hashlib.md5(url_without_query.encode("utf-8")).hexdigest()
        video_id = f"vid-{url_hash}"
        video_path = f"{save_dir}/{video_id}.mp4"

        if os.path.exists(video_path) and os.path.getsize(video_path) > 0:
            logger.info(f"video already exists: {video_path}")
            return video_path

        logger.info(f"downloading video: {video_url}")
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(video_url, headers=self.headers, timeout=aiohttp.ClientTimeout(total=240)) as r:
                    with open(video_path, "wb") as f:
                        f.write(await r.read())

            if os.path.exists(video_path) and os.path.getsize(video_path) > 0:
                try:
                    clip = VideoFileClip(video_path)
                    duration = clip.duration
                    fps = clip.fps
                    clip.close()
                    if duration > 0 and fps > 0:
                        return video_path
                except Exception as e:
                    logger.warning(f"invalid video file: {video_path} => {str(e)}")
                    os.remove(video_path)
        except Exception as e:
            logger.error(f"download video failed: {str(e)}")
            if os.path.exists(video_path):
                os.remove(video_path)

        return ""
