import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.graph import EntityCard, GraphEntity, GraphRelation
from app.models.user import User
from app.schemas.graph import (
    EntityCardItem,
    GraphEntityDetailResponse,
    GraphEntityResponse,
    GraphRelationResponse,
    GraphRelationUpdate,
    GraphSearchRequest,
    GraphSearchResponse,
    GraphStatsResponse,
    NeighborEntity,
)
from app.utils.auth import get_current_user, get_workspace_membership

logger = logging.getLogger(__name__)
router = APIRouter()


def _parse_uuid(value: str, field_name: str = "id") -> uuid.UUID:
    """Parse a string into UUID, raising 400 on failure."""
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}")


# ---------------------------------------------------------------------------
# GET /entities  –  list entities for a workspace
# ---------------------------------------------------------------------------


@router.get("/entities", response_model=list[GraphEntityResponse])
async def list_entities(
    workspace_id: str = Query(...),
    entity_type: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ws_id = _parse_uuid(workspace_id, "workspace_id")
    membership = await get_workspace_membership(ws_id, user, db)

    stmt = select(GraphEntity).where(GraphEntity.workspace_id == membership.workspace_id)
    if entity_type:
        stmt = stmt.where(GraphEntity.entity_type == entity_type)
    stmt = stmt.order_by(GraphEntity.updated_at.desc()).limit(limit)

    result = await db.execute(stmt)
    entities = result.scalars().all()
    return entities


# ---------------------------------------------------------------------------
# GET /entities/{entity_id}  –  entity detail + neighbors + related cards
# ---------------------------------------------------------------------------


@router.get("/entities/{entity_id}", response_model=GraphEntityDetailResponse)
async def get_entity(
    entity_id: str,
    workspace_id: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ws_id = _parse_uuid(workspace_id, "workspace_id")
    membership = await get_workspace_membership(ws_id, user, db)
    eid = _parse_uuid(entity_id, "entity_id")

    entity = await db.get(GraphEntity, eid)
    if entity is None or entity.workspace_id != membership.workspace_id:
        raise HTTPException(status_code=404, detail="Entity not found")

    # Neighbor entities via relations
    out_stmt = (
        select(GraphRelation.relation, GraphEntity.id, GraphEntity.name)
        .join(GraphEntity, GraphRelation.tail_id == GraphEntity.id)
        .where(GraphRelation.head_id == eid, GraphRelation.workspace_id == membership.workspace_id)
    )
    in_stmt = (
        select(GraphRelation.relation, GraphEntity.id, GraphEntity.name)
        .join(GraphEntity, GraphRelation.head_id == GraphEntity.id)
        .where(GraphRelation.tail_id == eid, GraphRelation.workspace_id == membership.workspace_id)
    )

    neighbors: list[NeighborEntity] = []
    out_rows = (await db.execute(out_stmt)).all()
    for row in out_rows:
        neighbors.append(
            NeighborEntity(entity_id=row[1], name=row[2], relation=row[0], direction="outgoing")
        )
    in_rows = (await db.execute(in_stmt)).all()
    for row in in_rows:
        neighbors.append(
            NeighborEntity(entity_id=row[1], name=row[2], relation=row[0], direction="incoming")
        )

    # Related cards via entity_cards join
    from app.models.card import Card

    card_stmt = (
        select(Card.id, Card.title)
        .join(EntityCard, EntityCard.card_id == Card.id)
        .where(EntityCard.entity_id == eid)
    )
    card_rows = (await db.execute(card_stmt)).all()
    related_cards = [EntityCardItem(card_id=row.id, title=row.title) for row in card_rows]

    return GraphEntityDetailResponse(
        id=entity.id,
        workspace_id=entity.workspace_id,
        name=entity.name,
        entity_type=entity.entity_type,
        access_count=entity.access_count,
        created_at=entity.created_at,
        updated_at=entity.updated_at,
        related_cards=related_cards,
        neighbor_entities=neighbors,
    )


# ---------------------------------------------------------------------------
# GET /relations  –  list relations for a workspace
# ---------------------------------------------------------------------------


@router.get("/relations", response_model=list[GraphRelationResponse])
async def list_relations(
    workspace_id: str = Query(...),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ws_id = _parse_uuid(workspace_id, "workspace_id")
    membership = await get_workspace_membership(ws_id, user, db)

    # Join with GraphEntity to resolve head/tail names
    head_ent = GraphEntity.__table__.alias("head_ent")
    tail_ent = GraphEntity.__table__.alias("tail_ent")

    stmt = (
        select(
            GraphRelation,
            head_ent.c.name.label("head_name"),
            tail_ent.c.name.label("tail_name"),
        )
        .join(head_ent, GraphRelation.head_id == head_ent.c.id)
        .join(tail_ent, GraphRelation.tail_id == tail_ent.c.id)
        .where(GraphRelation.workspace_id == membership.workspace_id)
        .order_by(GraphRelation.created_at.desc())
        .limit(limit)
    )

    rows = (await db.execute(stmt)).all()
    results: list[GraphRelationResponse] = []
    for row in rows:
        rel = row[0]
        results.append(
            GraphRelationResponse(
                id=rel.id,
                workspace_id=rel.workspace_id,
                head_id=rel.head_id,
                head_name=row.head_name or "",
                relation=rel.relation,
                tail_id=rel.tail_id,
                tail_name=row.tail_name or "",
                weight=rel.weight,
                source_card_id=rel.source_card_id,
                created_at=rel.created_at,
            )
        )
    return results


# ---------------------------------------------------------------------------
# POST /search  –  graph-enhanced search
# ---------------------------------------------------------------------------


@router.post("/search", response_model=GraphSearchResponse)
async def graph_search(
    req: GraphSearchRequest,
    workspace_id: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ws_id = _parse_uuid(workspace_id, "workspace_id")
    membership = await get_workspace_membership(ws_id, user, db)

    from app.services.gnn_retriever import graph_retriever

    return await graph_retriever.retrieve(req.query, membership.workspace_id, db, k=req.k)



# ---------------------------------------------------------------------------
# PUT /triples/{triple_id}  –  correct a triple
# ---------------------------------------------------------------------------


@router.put("/triples/{triple_id}", response_model=GraphRelationResponse)
async def correct_triple(
    triple_id: str,
    req: GraphRelationUpdate,
    workspace_id: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ws_id = _parse_uuid(workspace_id, "workspace_id")
    membership = await get_workspace_membership(ws_id, user, db)
    tid = _parse_uuid(triple_id, "triple_id")

    relation = await db.get(GraphRelation, tid)
    if relation is None or relation.workspace_id != membership.workspace_id:
        raise HTTPException(status_code=404, detail="Triple not found")

    if req.relation is not None:
        relation.relation = req.relation
    if req.weight is not None:
        relation.weight = req.weight
    await db.flush()
    await db.refresh(relation)

    # Resolve entity names for the response
    head = await db.get(GraphEntity, relation.head_id)
    tail = await db.get(GraphEntity, relation.tail_id)

    return GraphRelationResponse(
        id=relation.id,
        workspace_id=relation.workspace_id,
        head_id=relation.head_id,
        head_name=head.name if head else "",
        relation=relation.relation,
        tail_id=relation.tail_id,
        tail_name=tail.name if tail else "",
        weight=relation.weight,
        source_card_id=relation.source_card_id,
        created_at=relation.created_at,
    )


# ---------------------------------------------------------------------------
# GET /stats  –  graph statistics
# ---------------------------------------------------------------------------


@router.get("/stats", response_model=GraphStatsResponse)
async def graph_stats(
    workspace_id: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ws_id = _parse_uuid(workspace_id, "workspace_id")
    membership = await get_workspace_membership(ws_id, user, db)
    ws = membership.workspace_id

    # Entity count
    ent_count = await db.scalar(
        select(func.count()).select_from(GraphEntity).where(GraphEntity.workspace_id == ws)
    )

    # Relation count
    rel_count = await db.scalar(
        select(func.count()).select_from(GraphRelation).where(GraphRelation.workspace_id == ws)
    )

    # Relation type breakdown
    type_rows = (
        await db.execute(
            select(GraphRelation.relation, func.count().label("cnt"))
            .where(GraphRelation.workspace_id == ws)
            .group_by(GraphRelation.relation)
        )
    ).all()
    relation_type_counts = {row.relation: row.cnt for row in type_rows}

    return GraphStatsResponse(
        entity_count=ent_count or 0,
        relation_count=rel_count or 0,
        relation_type_counts=relation_type_counts,
    )


# ---------------------------------------------------------------------------
# POST /communities/detect  –  run Leiden community detection
# ---------------------------------------------------------------------------


@router.post("/communities/detect")
async def detect_communities(
    workspace_id: str = Query(...),
    resolution: float = Query(1.0, ge=0.1, le=5.0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ws_id = _parse_uuid(workspace_id, "workspace_id")
    membership = await get_workspace_membership(ws_id, user, db)

    from app.services.community import community_detector

    communities = await community_detector.detect_and_report(
        membership.workspace_id, db, resolution=resolution
    )
    await db.commit()

    return {
        "communities_detected": len(communities),
        "communities": [
            {
                "id": str(c.id),
                "title": c.title,
                "size": c.size,
                "level": c.level,
            }
            for c in communities
        ],
    }


# ---------------------------------------------------------------------------
# GET /communities  –  list communities with reports
# ---------------------------------------------------------------------------


@router.get("/communities")
async def list_communities(
    workspace_id: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ws_id = _parse_uuid(workspace_id, "workspace_id")
    membership = await get_workspace_membership(ws_id, user, db)

    from app.models.graph import Community, CommunityReport

    result = await db.execute(
        select(Community, CommunityReport)
        .outerjoin(CommunityReport, CommunityReport.community_id == Community.id)
        .where(Community.workspace_id == membership.workspace_id)
        .order_by(Community.size.desc())
    )

    items = []
    for community, report in result.all():
        items.append({
            "id": str(community.id),
            "title": report.title if report else community.title,
            "size": community.size,
            "level": community.level,
            "summary": report.summary if report else "",
            "findings": report.findings if report else [],
            "rating": report.rating if report else 0.0,
        })

    return {"communities": items}


# ---------------------------------------------------------------------------
# POST /cleanup  –  prune orphan entities and stale relations
# ---------------------------------------------------------------------------


@router.post("/cleanup")
async def cleanup_graph(
    workspace_id: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ws_id = _parse_uuid(workspace_id, "workspace_id")
    membership = await get_workspace_membership(ws_id, user, db)

    from app.services.graph_cleanup import graph_cleaner

    stats = await graph_cleaner.cleanup_workspace(membership.workspace_id, db)
    await db.commit()
    return stats


# ---------------------------------------------------------------------------
# POST /hnsw-index  –  create HNSW index for fast vector search
# ---------------------------------------------------------------------------


@router.post("/hnsw-index")
async def create_hnsw_index(
    workspace_id: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ws_id = _parse_uuid(workspace_id, "workspace_id")
    membership = await get_workspace_membership(ws_id, user, db)
    from app.utils.auth import require_role
    require_role(membership, "owner", "admin")

    from app.services.graph_cleanup import graph_cleaner

    await graph_cleaner.create_hnsw_index(db)
    return {"ok": True, "message": "HNSW index created"}
