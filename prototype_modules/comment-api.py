"""
Domino Dev Tools — Comment persistence API.

Mount this router into your prototype's FastAPI app:

    from comment_api import router as dev_tools_router
    app.include_router(dev_tools_router)

Comments are stored as a JSON file in dev-tools-data/comments.json.
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import json, os, uuid
from datetime import datetime, timezone

router = APIRouter(prefix="/api/dev-tools")

COMMENTS_DIR = "dev-tools-data"
COMMENTS_FILE = os.path.join(COMMENTS_DIR, "comments.json")


class CommentCreate(BaseModel):
    page: str
    targetComponent: str
    targetIndex: int = 0
    xPercent: float
    yPercent: float
    text: str
    author: str = "Anonymous"
    viewState: Optional[str] = None


class CommentUpdate(BaseModel):
    resolved: Optional[bool] = None
    text: Optional[str] = None


def _load():
    if not os.path.exists(COMMENTS_FILE):
        return []
    with open(COMMENTS_FILE) as f:
        return json.load(f)


def _save(comments):
    os.makedirs(COMMENTS_DIR, exist_ok=True)
    with open(COMMENTS_FILE, "w") as f:
        json.dump(comments, f, indent=2)


@router.get("/comments")
async def get_comments(page: Optional[str] = Query(None)):
    comments = _load()
    if page:
        comments = [c for c in comments if c["page"] == page]
    return comments


@router.post("/comments")
async def create_comment(body: CommentCreate):
    comments = _load()
    comment = {
        "id": str(uuid.uuid4()),
        **body.model_dump(),
        "resolved": False,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    comments.append(comment)
    _save(comments)
    return comment


@router.patch("/comments/{comment_id}")
async def update_comment(comment_id: str, body: CommentUpdate):
    comments = _load()
    for c in comments:
        if c["id"] == comment_id:
            update = body.model_dump(exclude_none=True)
            c.update(update)
            _save(comments)
            return c
    raise HTTPException(404, "Comment not found")


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: str):
    comments = _load()
    comments = [c for c in comments if c["id"] != comment_id]
    _save(comments)
    return {"ok": True}
