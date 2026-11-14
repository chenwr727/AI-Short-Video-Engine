import asyncio
import threading
from typing import Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from api.schemas import TaskCreate
from main import url2video
from utils.config import api_config as settings
from utils.log import logger

from . import crud
from .database import AsyncSessionLocal
from .models import Task, TaskStatus

# A dedicated event loop running in a background thread. `url2video` performs many
# synchronous/blocking calls (requests, moviepy, ffmpeg); running it here keeps
# those off the FastAPI event loop so API requests stay responsive while a video
# is being generated.
_bg_loop: Optional[asyncio.AbstractEventLoop] = None
_bg_loop_lock = threading.Lock()


def _get_bg_loop() -> asyncio.AbstractEventLoop:
    global _bg_loop
    if _bg_loop is None or _bg_loop.is_closed():
        with _bg_loop_lock:
            if _bg_loop is None or _bg_loop.is_closed():
                loop = asyncio.new_event_loop()
                threading.Thread(target=_run_bg_loop, args=(loop,), name="bg-loop", daemon=True).start()
                _bg_loop = loop
    return _bg_loop


def _run_bg_loop(loop: asyncio.AbstractEventLoop) -> None:
    asyncio.set_event_loop(loop)
    loop.run_forever()


async def _run_coroutine_in_bg(coro) -> any:
    """Schedule `coro` on the background loop and await its result on the caller's loop."""
    future = asyncio.run_coroutine_threadsafe(coro, _get_bg_loop())
    return await asyncio.wrap_future(future)


class TaskService:
    _semaphore = asyncio.Semaphore(settings.max_concurrent_tasks)
    _running_tasks: Dict[int, asyncio.Task] = {}
    _worker_task: Optional[asyncio.Task] = None
    _stop_event: Optional[asyncio.Event] = None
    _POLL_INTERVAL = 2.0

    # ------------------------------------------------------------------ lifecycle
    @classmethod
    async def start_worker(cls) -> None:
        """Recover interrupted tasks and start the background polling worker."""
        await cls._recover_interrupted_tasks()
        if cls._worker_task is None or cls._worker_task.done():
            cls._stop_event = asyncio.Event()
            cls._worker_task = asyncio.create_task(cls._worker_loop())
            logger.info("Task worker started")

    @classmethod
    async def stop_worker(cls) -> None:
        """Stop the worker and cancel any running tasks."""
        if cls._stop_event is not None:
            cls._stop_event.set()
        if cls._worker_task is not None:
            try:
                await asyncio.wait_for(cls._worker_task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                cls._worker_task.cancel()
            cls._worker_task = None
        for task in cls._running_tasks.values():
            task.cancel()
        cls._running_tasks.clear()
        logger.info("Task worker stopped")

    @classmethod
    async def _recover_interrupted_tasks(cls) -> None:
        """On startup, re-queue tasks that were RUNNING when the process died."""
        async with AsyncSessionLocal() as session:
            n = await crud.reset_interrupted_tasks(session)
            if n:
                logger.info(f"Recovered {n} interrupted RUNNING task(s) back to PENDING")

    # ------------------------------------------------------------------ worker loop
    @classmethod
    async def _worker_loop(cls) -> None:
        """Poll the DB for PENDING tasks and execute them under a concurrency limit."""
        while not cls._stop_event.is_set():
            try:
                await cls._drain_pending()
            except Exception as e:
                logger.error(f"Worker loop error: {e}")
            try:
                await asyncio.wait_for(cls._stop_event.wait(), timeout=cls._POLL_INTERVAL)
            except asyncio.TimeoutError:
                pass

    @classmethod
    async def _drain_pending(cls) -> None:
        """Claim and run as many PENDING tasks as the concurrency limit allows."""
        while not cls._stop_event.is_set():
            async with AsyncSessionLocal() as session:
                task = await crud.claim_pending_task(session)
            if task is None:
                break

            task_create = TaskCreate(
                name=task.name,
                prompt_source=task.prompt_source,
                tts_source=task.tts_source,
                material_source=task.material_source,
            )
            coro = cls._run_task(task.id, task_create)
            cls._running_tasks[task.id] = asyncio.create_task(coro)

            if len(cls._running_tasks) >= settings.max_concurrent_tasks:
                break

    # ------------------------------------------------------------------ task execution
    @classmethod
    async def _run_task(cls, task_id: int, task_create: TaskCreate) -> None:
        """Execute one task on the background loop (RUNNING -> terminal state)."""
        try:
            async with cls._semaphore:
                async with AsyncSessionLocal() as session:
                    task = await crud.get_task(session, task_id)
                    if task is None:
                        return

                    try:
                        # Run url2video on the background loop so its blocking calls
                        # don't stall the FastAPI event loop.
                        result = await asyncio.wait_for(
                            _run_coroutine_in_bg(url2video(task_create, task_id)),
                            timeout=float(settings.task_timeout_seconds),
                        )
                        await crud.update_task_status(session, task, TaskStatus.COMPLETED, result=result)

                    except asyncio.CancelledError:
                        await crud.update_task_status(
                            session, task, TaskStatus.CANCELLED, "Task was manually cancelled"
                        )

                    except asyncio.TimeoutError:
                        await crud.update_task_status(
                            session,
                            task,
                            TaskStatus.TIMEOUT,
                            f"Task exceeded {settings.task_timeout_seconds} second timeout limit",
                        )

                    except Exception as e:
                        await crud.update_task_status(session, task, TaskStatus.FAILED, str(e))
        finally:
            cls._running_tasks.pop(task_id, None)

    # ------------------------------------------------------------------ public API
    @classmethod
    async def cancel_task(cls, session: AsyncSession, task: Task) -> None:
        """Cancel a running or queued task. No-op if it already finished."""
        running = cls._running_tasks.get(task.id)
        if running and not running.done():
            running.cancel()
            try:
                await running
            except asyncio.CancelledError:
                pass
        else:
            await crud.update_task_status(session, task, TaskStatus.CANCELLED, "Task was cancelled")
