# server/tests/test_crystallize_is_temp.py
import uuid


def test_crystallize_card_kwargs_is_temp_true():
    """_build_crystallize_card_kwargs must return is_temp=True."""
    from app.api.chat import _build_crystallize_card_kwargs
    kwargs = _build_crystallize_card_kwargs(
        workspace_id=str(uuid.uuid4()),
        user_id=str(uuid.uuid4()),
        title="Test title",
        summary="Some content",
        keywords=["a", "b"],
    )
    assert kwargs["is_temp"] is True


def test_crystallize_card_kwargs_fields():
    """_build_crystallize_card_kwargs must include all required Card fields."""
    from app.api.chat import _build_crystallize_card_kwargs
    ws_id = str(uuid.uuid4())
    u_id = str(uuid.uuid4())
    kwargs = _build_crystallize_card_kwargs(
        workspace_id=ws_id,
        user_id=u_id,
        title="T",
        summary="C",
        keywords=["x"],
    )
    assert kwargs["workspace_id"] == ws_id
    assert kwargs["creator_id"] == u_id
    assert kwargs["title"] == "T"
    assert kwargs["content"] == "C"
    assert kwargs["keywords"] == ["x"]
    assert "local_id" in kwargs
    assert kwargs["local_id"].startswith("summary_")
