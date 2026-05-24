from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
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
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # Embedding
    embedding_model: str = "BAAI/bge-base-zh-v1.5"
    embedding_dim: int = 768

    # LLM (DeepSeek)
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"

    # CORS
    cors_origins: str = "*"

    # Search
    search_top_k: int = 20
    rag_top_k: int = 5

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @model_validator(mode="after")
    def _check_required_fields(self):
        if not self.jwt_secret:
            raise ValueError("JWT_SECRET environment variable is required")
        if len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        return self


settings = Settings()
