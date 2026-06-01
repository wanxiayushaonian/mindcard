from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # General
    debug: bool = False

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

    # Embedding
    embedding_model: str = "BAAI/bge-base-zh-v1.5"
    embedding_dim: int = 768

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

    # CORS
    cors_origins: str = "*"

    # Rate limiting
    rate_limit_auth_max: int = 10
    rate_limit_auth_window: int = 60
    rate_limit_ai_max: int = 20
    rate_limit_ai_window: int = 60
    rate_limit_rag_max: int = 10
    rate_limit_rag_window: int = 60

    # Search
    search_top_k: int = 20
    rag_top_k: int = 5

    # GNN Training
    gnn_training_mode: str = "auto"  # "auto", "local_cpu", "local_gpu", "remote_gpu"
    gnn_training_trigger_cards: int = 100
    gnn_training_trigger_days: int = 7
    gnn_hidden_dim: int = 256
    gnn_num_layers: int = 3
    gnn_learning_rate: float = 0.001
    gnn_num_epochs: int = 50

    # Modal Labs (Remote GPU)
    modal_app_name: str = ""
    modal_api_key: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @model_validator(mode="after")
    def _check_required_fields(self):
        if not self.jwt_secret:
            raise ValueError("JWT_SECRET environment variable is required")
        if len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        return self


settings = Settings()
