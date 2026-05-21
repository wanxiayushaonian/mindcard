from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import auth, cards, comments, rag, search, workspaces


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize embedding model, redis, etc.
    yield
    # Shutdown: cleanup


app = FastAPI(
    title="MindCard API",
    description="Vector search, RAG, and collaboration for MindCard",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(workspaces.router, prefix="/api/workspaces", tags=["workspaces"])
app.include_router(cards.router, prefix="/api/cards", tags=["cards"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(rag.router, prefix="/api/rag", tags=["rag"])
app.include_router(comments.router, prefix="/api/cards", tags=["comments"])


@app.get("/health")
async def health():
    return {"status": "ok"}
