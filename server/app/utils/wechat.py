import httpx

from app.config import settings

# ── Miniapp ──

WECHAT_LOGIN_URL = "https://api.weixin.qq.com/sns/jscode2session"


async def code_to_openid(code: str) -> dict:
    """Exchange WeChat miniapp login code for openid and session_key."""
    async with httpx.AsyncClient(trust_env=False) as client:
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


# ── Web (公众号 OAuth) ──

WEB_AUTHORIZE_URL = "https://open.weixin.qq.com/connect/qrconnect"
WEB_TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token"
WEB_USERINFO_URL = "https://api.weixin.qq.com/sns/userinfo"


def get_web_authorize_url(redirect_uri: str, state: str = "") -> str:
    """Build WeChat OAuth authorize URL for web QR code login."""
    from urllib.parse import quote
    return (
        f"{WEB_AUTHORIZE_URL}"
        f"?appid={settings.wechat_web_appid}"
        f"&redirect_uri={quote(redirect_uri, safe='')}"
        f"&response_type=code"
        f"&scope=snsapi_login"
        f"&state={state}#wechat_redirect"
    )


async def exchange_web_code(code: str) -> dict:
    """Exchange WeChat web OAuth code for access_token, openid, and optionally unionid."""
    async with httpx.AsyncClient(trust_env=False) as client:
        resp = await client.get(
            WEB_TOKEN_URL,
            params={
                "appid": settings.wechat_web_appid,
                "secret": settings.wechat_web_secret,
                "code": code,
                "grant_type": "authorization_code",
            },
        )
        data = resp.json()
        if "errcode" in data and data["errcode"] != 0:
            raise ValueError(f"WeChat OAuth failed: {data.get('errmsg', 'unknown error')}")
        return data


async def get_web_userinfo(access_token: str, openid: str) -> dict:
    """Get WeChat web user info (nickname, avatar, etc.)."""
    async with httpx.AsyncClient(trust_env=False) as client:
        resp = await client.get(
            WEB_USERINFO_URL,
            params={
                "access_token": access_token,
                "openid": openid,
                "lang": "zh_CN",
            },
        )
        data = resp.json()
        if "errcode" in data and data["errcode"] != 0:
            raise ValueError(f"WeChat userinfo failed: {data.get('errmsg', 'unknown error')}")
        return data
