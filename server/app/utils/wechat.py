import httpx

from app.config import settings

WECHAT_LOGIN_URL = "https://api.weixin.qq.com/sns/jscode2session"


async def code_to_openid(code: str) -> dict:
    """Exchange WeChat login code for openid and session_key."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            WECHAT_LOGIN_URL,
            params={
                "appid": settings.wechat_appid,
                "secret": settings.wechat_secret,
                "js_code": code,
                "grant_type": "authorization_code",
            },
        )
        data = resp.json()
        if "errcode" in data and data["errcode"] != 0:
            raise ValueError(f"WeChat login failed: {data.get('errmsg', 'unknown error')}")
        return data
