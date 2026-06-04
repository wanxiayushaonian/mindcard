import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import activities, ai, api_keys, auth, cards, chat, comments, external, graph, insights, notifications, rag, search, topics, topology, workspaces, ws
from app.api import settings as settings_router
from app.config import settings


def _setup_logging():
    log_level = getattr(settings, "log_level", "INFO").upper()
    fmt = "%(asctime)s %(levelname)-5s [%(name)s] %(message)s"
    datefmt = "%H:%M:%S"

    logging.basicConfig(level=log_level, format=fmt, datefmt=datefmt)

    # Reduce noise from libraries
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("asyncpg").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    # App modules at INFO
    for mod in ("app.api", "app.services", "app.providers"):
        logging.getLogger(mod).setLevel(logging.INFO)


_setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("MindCard API starting...")
    logger.info("LLM: provider=%s, model=%s", settings.default_llm_provider, settings.default_llm_model or "(default)")
    logger.info("Extraction: provider=%s, model=%s", settings.extraction_llm_provider or "(follow main)", settings.extraction_llm_model or "(default)")
    logger.info("Embedding: model=%s @ %s", settings.embedding_model, settings.ollama_base_url)
    yield
    # Shutdown: cleanup
    from app.services.embedding import embedding_service
    await embedding_service.close()


app = FastAPI(
    title="MindCard API",
    description="Vector search, RAG, and collaboration for MindCard",
    version="0.1.0",
    lifespan=lifespan,
)

origins = [o.strip() for o in settings.cors_origins.split(",")] if settings.cors_origins != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(workspaces.router, prefix="/api/workspaces", tags=["workspaces"])
app.include_router(cards.router, prefix="/api/cards", tags=["cards"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(rag.router, prefix="/api/rag", tags=["rag"])
app.include_router(chat.router, prefix="/api/chats", tags=["chats"])
app.include_router(comments.router, prefix="/api/cards", tags=["comments"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["notifications"])
app.include_router(activities.router, prefix="/api/activities", tags=["activities"])
app.include_router(api_keys.router, prefix="/api/settings/api-keys", tags=["api-keys"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])
app.include_router(external.router, prefix="/api/external", tags=["external"])
app.include_router(topics.router, prefix="/api/topics", tags=["topics"])
app.include_router(topology.router, prefix="/api/topology", tags=["topology"])
app.include_router(graph.router, prefix="/api/graph", tags=["graph"])
app.include_router(insights.router, prefix="/api/chats", tags=["insights"])
app.include_router(ws.router, prefix="/api", tags=["websocket"])


@app.get("/health")
async def health():
    return {"status": "ok"}
