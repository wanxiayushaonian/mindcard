from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # General
    debug: bool = False
    log_level: str = "INFO"

    # Database
    database_url: str = "postgresql+asyncpg://mindcard:mindcard@localhost:5432/mindcard"

    # WeChat Miniapp
    wechat_appid: str = ""
    wechat_secret: str = ""

    # WeChat Web (公众号 OAuth)
    wechat_web_appid: str = ""
    wechat_web_secret: str = ""

    # JWT
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24  # 24 hours

    # Embedding — provider: "ollama" (local Ollama) or "openai" (OpenAI-compatible API)
    ollama_base_url: str = "http://localhost:11434"
    embedding_provider: str = "ollama"
    embedding_base_url: str = ""  # OpenAI-compatible base URL, e.g. https://api.siliconflow.cn/v1
    embedding_api_key: str = ""  # required when embedding_provider == "openai"
    embedding_model: str = "bge-m3"  # ollama: "bge-m3"; openai: e.g. "BAAI/bge-m3"
    embedding_dim: int = 1024  # must match the DB vector(1024) columns

    # LLM — DeepSeek (default)
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"

    # LLM — OpenAI
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com"

    # LLM — Anthropic (Claude)
    anthropic_api_key: str = ""
    anthropic_base_url: str = "https://api.anthropic.com"

    # LLM — Gemini
    gemini_api_key: str = ""

    # LLM — Moonshot
    moonshot_api_key: str = ""

    # LLM — Custom (OpenAI-compatible endpoint)
    custom_api_key: str = ""
    custom_base_url: str = ""
    custom_model: str = ""

    # LLM defaults
    default_llm_provider: str = "claude"  # Changed from deepseek to claude
    default_llm_model: str = ""  # empty = provider's default model

    # LLM for lightweight tasks (title generation, keyword extraction)
    extraction_llm_provider: str = ""  # empty = use default_llm_provider
    extraction_llm_model: str = ""  # empty = use provider's default model

    # Admin whitelist (comma-separated usernames). Gates server-wide settings
    # (provider switching, web-search config, .env writes). Empty = all denied.
    admin_usernames: str = ""

    # CORS
    cors_origins: str = "*"

    # Rate limiting
    rate_limit_auth_max: int = 10
    rate_limit_auth_window: int = 60
    rate_limit_ai_max: int = 20
    rate_limit_ai_window: int = 60
    rate_limit_rag_max: int = 10
    rate_limit_rag_window: int = 60
    rate_limit_ws_max: int = 60  # WebSocket chat/rag messages per user per window
    rate_limit_ws_window: int = 60

    # Search
    search_top_k: int = 20
    rag_top_k: int = 5

    # Web Search
    web_search_provider: str = "duckduckgo"  # duckduckgo, brave, tavily, searxng, jina, kagi
    web_search_api_key: str = ""
    web_search_base_url: str = ""  # for SearXNG
    web_search_max_results: int = 5
    web_search_timeout: int = 30
    web_search_proxy: str = ""  # HTTP/SOCKS proxy for web search requests

    # Fork system
    auto_fork_enabled: bool = True
    fork_context_strategy: str = "compress"  # none | inherit | compress
    split_guard_min_messages: int = 5

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @model_validator(mode="after")
    def _check_required_fields(self):
        if not self.jwt_secret:
            raise ValueError("JWT_SECRET environment variable is required")
        if len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        return self


settings = Settings()
