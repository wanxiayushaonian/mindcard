# server/tests/test_promote_triggers_pipeline.py
import uuid
from unittest.mock import MagicMock
from fastapi import BackgroundTasks


def test_promote_triggers_pipeline():
    """When is_temp flips True->False, _generate_embedding must be scheduled."""
    from app.api.cards import _maybe_trigger_pipeline_on_promote, _generate_embedding

    background_tasks = MagicMock(spec=BackgroundTasks)
    card = MagicMock()
    card.id = uuid.uuid4()

    _maybe_trigger_pipeline_on_promote(
        background_tasks=background_tasks,
        card=card,
        was_temp=True,
        update_data={"is_temp": False},
    )

    background_tasks.add_task.assert_called_once_with(_generate_embedding, card.id)


def test_no_trigger_when_already_permanent():
    """No pipeline trigger when card was already is_temp=False."""
    from app.api.cards import _maybe_trigger_pipeline_on_promote

    background_tasks = MagicMock(spec=BackgroundTasks)
    card = MagicMock()
    card.id = uuid.uuid4()

    _maybe_trigger_pipeline_on_promote(
        background_tasks=background_tasks,
        card=card,
        was_temp=False,
        update_data={"is_temp": False},
    )

    background_tasks.add_task.assert_not_called()


def test_no_trigger_when_still_temp():
    """No pipeline trigger when card remains is_temp=True."""
    from app.api.cards import _maybe_trigger_pipeline_on_promote

    background_tasks = MagicMock(spec=BackgroundTasks)
    card = MagicMock()
    card.id = uuid.uuid4()

    _maybe_trigger_pipeline_on_promote(
        background_tasks=background_tasks,
        card=card,
        was_temp=True,
        update_data={"is_temp": True},
    )

    background_tasks.add_task.assert_not_called()


def test_no_trigger_when_is_temp_not_in_update():
    """No pipeline trigger when update_data does not touch is_temp."""
    from app.api.cards import _maybe_trigger_pipeline_on_promote

    background_tasks = MagicMock(spec=BackgroundTasks)
    card = MagicMock()
    card.id = uuid.uuid4()

    _maybe_trigger_pipeline_on_promote(
        background_tasks=background_tasks,
        card=card,
        was_temp=True,
        update_data={"title": "New title"},
    )

    background_tasks.add_task.assert_not_called()
