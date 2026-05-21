"""One-time migration script: import data from WeChat Cloud to PostgreSQL.

Usage:
    uv run python -m app.scripts.migrate_from_cloud --user <openid>
"""
import argparse
import asyncio
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main(openid: str):
    from app.services.sync import sync_service

    logger.info("Starting migration for user: %s", openid)
    result = await sync_service.migrate_from_cloud(openid)
    logger.info("Migration complete: %s", result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate data from WeChat Cloud to PostgreSQL")
    parser.add_argument("--user", required=True, help="WeChat openid of the user")
    args = parser.parse_args()
    asyncio.run(main(args.user))
