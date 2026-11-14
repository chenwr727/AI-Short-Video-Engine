from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api import crud
from api.database import get_session
from api.models import TaskStatus
from api.schemas import TaskCreate, TaskResponse
from api.service import TaskService
from utils.config import api_config as settings

tasks_router = APIRouter()


@tasks_router.post("/", response_model=TaskResponse)
async def create_task(task: TaskCreate, session: AsyncSession = Depends(get_session)):
    db_task, _ = await crud.create_task(session, task)
    return db_task


@tasks_router.post("/{task_id}/cancel")
async def cancel_task(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await crud.get_task(session, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status not in (TaskStatus.PENDING, TaskStatus.RUNNING):
        raise HTTPException(status_code=400, detail="Only pending or running tasks can be cancelled")

    await TaskService.cancel_task(session, task)
    return {"message": "Task was cancelled"}


@tasks_router.get("/queue/status")
async def get_queue_status(session: AsyncSession = Depends(get_session)):
    running = await crud.get_running_count(session)
    return {
        "max_concurrent_tasks": settings.max_concurrent_tasks,
        "running_tasks": running,
        "available_slots": max(0, settings.max_concurrent_tasks - running),
    }


@tasks_router.get("/list/{task_date}", response_model=List[TaskResponse])
async def get_task_list(task_date: str, session: AsyncSession = Depends(get_session)):
    return await crud.get_task_list(session, task_date)


@tasks_router.get("/{task_id}", response_model=TaskResponse)
async def get_task_status(task_id: int, session: AsyncSession = Depends(get_session)):
    task = await crud.get_task(session, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task
