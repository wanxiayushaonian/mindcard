import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import uuid

@pytest.mark.asyncio
async def test_process_card_skips_temp():
    """_process_card must exit early and never call embed when is_temp=True."""
    card_id = uuid.uuid4()
    mock_card = MagicMock()
    mock_card.is_temp = True

    async def mock_get(model, pk):
        return mock_card

    mock_db = AsyncMock()
    mock_db.get = mock_get

    with patch("app.database.async_session") as mock_session_ctx:
        mock_session_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_db)
        mock_session_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("app.services.embedding.embedding_service.embed") as mock_embed:
            from app.utils.card_tasks import _process_card
            await _process_card(card_id)
            mock_embed.assert_not_called()
