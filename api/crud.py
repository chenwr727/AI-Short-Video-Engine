from datetime import datetime
from typing import Optional

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .models import Task, TaskStatus
from .schemas import TaskCreate


async def create_task(session: Session, task: TaskCreate) -> tuple[Task, bool]:
    result = await session.execute(select(Task).where(Task.name == task.name))
    db_task = result.scalars().first()
    if db_task:
        db_task.status = TaskStatus.PENDING
        db_task.prompt_source = task.prompt_source
        db_task.tts_source = task.tts_source
        db_task.material_source = task.material_source
        await session.commit()
        await session.refresh(db_task)
        return db_task, False
    else:
        db_task = Task(
            name=task.name,
            status=TaskStatus.PENDING,
            prompt_source=task.prompt_source,
            tts_source=task.tts_source,
            material_source=task.material_source,
        )
        session.add(db_task)
        await session.commit()
        await session.refresh(db_task)
        return db_task, True


async def get_task(session: Session, task_id: int) -> Task:
    return await session.get(Task, task_id)


async def get_status(session: Session, task_date: str) -> dict[str, int]:
    result = await session.execute(
        select(Task.status, func.count(Task.id)).where(Task.create_time.like(f"%{task_date}%")).group_by(Task.status)
    )
    return dict(result.all())


async def get_running_count(session: Session) -> int:
    result = await session.execute(select(func.count(Task.id)).where(Task.status == TaskStatus.RUNNING))
    return result.scalar_one()


async def claim_pending_task(session: Session) -> Optional[Task]:
    result = await session.execute(
        select(Task)
        .where(Task.status == TaskStatus.PENDING)
        .order_by(Task.create_time.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    task = result.scalars().first()
    if task is not None:
        task.status = TaskStatus.RUNNING
        task.start_time = datetime.now()
        await session.commit()
        await session.refresh(task)
        return task
    await session.commit()
    return None


async def reset_interrupted_tasks(session: Session) -> int:
    """On startup, reset RUNNING tasks back to PENDING (their process died)."""
    result = await session.execute(
        update(Task)
        .where(Task.status == TaskStatus.RUNNING)
        .values(status=TaskStatus.PENDING, error_message="Interrupted by service restart, re-queued")
    )
    await session.commit()
    return result.rowcount or 0


async def get_task_list(session: Session, task_date: str) -> list[Task]:
    result = await session.execute(select(Task).where(Task.update_time.like(f"%{task_date}%")))
    return result.scalars().all()


async def update_task_status(session: Session, task: Task, status: TaskStatus, error_message=None, result=None) -> Task:
    task.status = status
    if status == TaskStatus.RUNNING:
        task.start_time = datetime.now()
        task.end_time = None
    else:
        task.end_time = datetime.now()
    task.result = result
    task.error_message = error_message
    await session.commit()
