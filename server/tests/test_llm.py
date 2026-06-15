"""Unit tests for LLMService."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestResolveCredentials:
    """Tests for _resolve_credentials static method."""

    @patch("app.services.llm.settings")
    def test_deepseek(self, mock_settings):
        mock_settings.deepseek_api_key = "sk-test"
        mock_settings.deepseek_base_url = "https://api.deepseek.com"

        from app.services.llm import LLMService

        key, url = LLMService._resolve_credentials("deepseek")
        assert key == "sk-test"
        assert url == "https://api.deepseek.com"

    @patch("app.services.llm.settings")
    def test_openai(self, mock_settings):
        mock_settings.openai_api_key = "sk-openai"
        mock_settings.openai_base_url = None

        from app.services.llm import LLMService

        key, url = LLMService._resolve_credentials("openai")
        assert key == "sk-openai"

    @patch("app.services.llm.settings")
    def test_claude(self, mock_settings):
        mock_settings.anthropic_api_key = "sk-ant-test"
        mock_settings.anthropic_base_url = None

        from app.services.llm import LLMService

        key, url = LLMService._resolve_credentials("claude")
        assert key == "sk-ant-test"

    @patch("app.services.llm.settings")
    def test_unknown_provider(self, mock_settings):
        from app.services.llm import LLMService

        key, url = LLMService._resolve_credentials("nonexistent")
        assert key == ""
        assert url is None

    @patch("app.services.llm.settings")
    def test_gemini(self, mock_settings):
        mock_settings.gemini_api_key = "gemini-key"

        from app.services.llm import LLMService

        key, url = LLMService._resolve_credentials("gemini")
        assert key == "gemini-key"
        assert url is None

    @patch("app.services.llm.settings")
    def test_custom(self, mock_settings):
        mock_settings.custom_api_key = "custom-key"
        mock_settings.custom_base_url = "https://custom.api.com"

        from app.services.llm import LLMService

        key, url = LLMService._resolve_credentials("custom")
        assert key == "custom-key"
        assert url == "https://custom.api.com"


class TestCompleteSimple:
    """Tests for complete_simple message construction."""

    @pytest.mark.asyncio
    async def test_message_construction(self):
        from app.services.llm import LLMService

        service = LLMService.__new__(LLMService)
        service._provider = MagicMock()
        service._provider.chat = AsyncMock(return_value=MagicMock(content="  response  "))
        service._extraction_provider = None

        result = await service.complete_simple(
            system_prompt="You are helpful",
            user_content="Hello",
        )

        # Should strip whitespace
        assert result == "response"

        # Verify message construction
        call_args = service._provider.chat.call_args
        messages = call_args[0][0]
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == "You are helpful"
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "Hello"

    @pytest.mark.asyncio
    async def test_result_is_stripped(self):
        from app.services.llm import LLMService

        service = LLMService.__new__(LLMService)
        service._provider = MagicMock()
        service._provider.chat = AsyncMock(return_value=MagicMock(content="\n\n  hello world  \n"))
        service._extraction_provider = None

        result = await service.complete_simple("sys", "user")
        assert result == "hello world"


class TestSwitchProvider:
    """Tests for switch_provider method."""

    def test_updates_provider(self):
        from app.services.llm import LLMService

        service = LLMService.__new__(LLMService)
        service._provider = MagicMock()
        service._provider_name = "deepseek"

        with patch("app.services.llm.make_provider") as mock_make:
            new_provider = MagicMock()
            mock_make.return_value = new_provider

            service.switch_provider("openai", "sk-test", model="gpt-4o")

            assert service._provider is new_provider
            assert service._provider_name == "openai"
            mock_make.assert_called_once_with(
                "openai", "sk-test", None, "gpt-4o"
            )
