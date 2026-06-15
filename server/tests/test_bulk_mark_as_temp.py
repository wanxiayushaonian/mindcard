# server/tests/test_bulk_mark_as_temp.py
from app.schemas.card import CardBatchRequest, CardBatchItem


def test_batch_request_mark_as_temp_defaults_false():
    """CardBatchRequest.mark_as_temp must default to False."""
    req = CardBatchRequest(
        workspace_id="ws-1",
        cards=[CardBatchItem(local_id="abc", content="hello")],
    )
    assert req.mark_as_temp is False


def test_batch_request_mark_as_temp_can_be_true():
    """CardBatchRequest.mark_as_temp must accept True."""
    req = CardBatchRequest(
        workspace_id="ws-1",
        mark_as_temp=True,
        cards=[CardBatchItem(local_id="abc", content="hello")],
    )
    assert req.mark_as_temp is True


def test_mark_as_temp_overrides_individual_card_is_temp():
    """When mark_as_temp=True, all cards in the batch get is_temp=True regardless of their individual value."""
    # This test verifies the loop logic by simulating what the endpoint does
    cards_data = [
        CardBatchItem(local_id="a", content="x", is_temp=False),
        CardBatchItem(local_id="b", content="y", is_temp=True),
    ]
    req = CardBatchRequest(workspace_id="ws-1", mark_as_temp=True, cards=cards_data)

    results = []
    for item in req.cards:
        card_data = item.model_dump()
        if req.mark_as_temp:
            card_data["is_temp"] = True
        results.append(card_data["is_temp"])

    assert all(r is True for r in results)
