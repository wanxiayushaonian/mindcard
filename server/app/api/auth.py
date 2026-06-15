import re

from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.utils.auth import (
    create_access_token,
    get_current_user,
    get_or_create_user,
    hash_password,
    verify_password,
)
from app.utils.rate_limit import RateLimitByIP, auth_limiter
from app.utils.wechat import (
    code_to_openid,
    exchange_web_code,
    get_web_authorize_url,
    get_web_userinfo,
)

router = APIRouter()


# ── Schemas ──


class RegisterRequest(BaseModel):
    username: str
    password: str
    nickname: str = ""

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3 or len(v) > 32:
            raise ValueError("Username must be 3-32 characters")
        if not re.match(r"^[a-zA-Z0-9_]+$", v):
            raise ValueError("Username can only contain letters, digits, and underscores")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v


class LoginRequest(BaseModel):
    username: str
    password: str


class WeChatLoginRequest(BaseModel):
    code: str


class WebOAuthRequest(BaseModel):
    code: str  # WeChat公众号 OAuth code


class DevLoginRequest(BaseModel):
    nickname: str = "Web用户"


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class WeChatQRResponse(BaseModel):
    authorize_url: str


class BindResultResponse(BaseModel):
    ok: bool
    message: str


class UserMeResponse(BaseModel):
    id: str
    username: str | None
    nickname: str
    avatar_url: str
    has_miniapp_wechat: bool
    has_web_wechat: bool


# ── Endpoints ──


@router.post("/register", response_model=TokenResponse)
async def register(
    req: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    _rl: None = Depends(RateLimitByIP(auth_limiter)),
):
    """Register a new user with username and password."""
    existing = await db.execute(select(User).where(User.username == req.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already taken")

    user = User(
        username=req.username,
        password_hash=hash_password(req.password),
        nickname=req.nickname or req.username,
    )
    db.add(user)
    await db.flush()
    await db.commit()

    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(
    req: LoginRequest,
    db: AsyncSession = Depends(get_db),
    _rl: None = Depends(RateLimitByIP(auth_limiter)),
):
    """Login with username and password."""
    result = await db.execute(select(User).where(User.username == req.username))
    user = result.scalar_one_or_none()
    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token)


@router.post("/wechat-login", response_model=TokenResponse)
async def wechat_login(
    req: WeChatLoginRequest,
    db: AsyncSession = Depends(get_db),
    _rl: None = Depends(RateLimitByIP(auth_limiter)),
):
    """WeChat mini-program login: exchange code for JWT."""
    try:
        wx_data = await code_to_openid(req.code)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    openid = wx_data["openid"]
    unionid = wx_data.get("unionid")

    # Try to find existing user by openid or unionid
    user = None
    result = await db.execute(select(User).where(User.wechat_openid == openid))
    user = result.scalar_one_or_none()

    if not user and unionid:
        result = await db.execute(select(User).where(User.wechat_unionid == unionid))
        user = result.scalar_one_or_none()
        if user:
            # Link miniapp openid to existing user
            user.wechat_openid = openid

    if not user:
        user = User(wechat_openid=openid, wechat_unionid=unionid)
        db.add(user)
        await db.flush()

    await db.commit()

    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token)


@router.post("/web-login", response_model=TokenResponse)
async def web_login(req: WebOAuthRequest, db: AsyncSession = Depends(get_db), _rl: None = Depends(RateLimitByIP(auth_limiter))):
    """Web端 WeChat OAuth 扫码登录."""
    try:
        token_data = await exchange_web_code(req.code)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    wx_openid = token_data["openid"]
    wx_unionid = token_data.get("unionid")
    access_token = token_data["access_token"]

    # Try to get user info for nickname/avatar
    nickname = ""
    avatar_url = ""
    try:
        info = await get_web_userinfo(access_token, wx_openid)
        nickname = info.get("nickname", "")
        avatar_url = info.get("headimgurl", "")
    except Exception:
        pass

    # Find existing user by web openid
    user = None
    result = await db.execute(select(User).where(User.wechat_web_openid == wx_openid))
    user = result.scalar_one_or_none()

    # Try unionid match (links miniapp and web accounts)
    if not user and wx_unionid:
        result = await db.execute(select(User).where(User.wechat_unionid == wx_unionid))
        user = result.scalar_one_or_none()
        if user:
            user.wechat_web_openid = wx_openid

    if not user:
        # Create new user
        user = User(
            wechat_web_openid=wx_openid,
            wechat_unionid=wx_unionid,
            nickname=nickname,
            avatar_url=avatar_url,
        )
        db.add(user)
        await db.flush()

    await db.commit()

    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token)


@router.get("/wechat-qr-url", response_model=WeChatQRResponse)
async def wechat_qr_url(redirect_uri: str):
    """Get WeChat OAuth authorize URL for QR code rendering."""
    if not settings.wechat_web_appid or not settings.wechat_web_secret:
        raise HTTPException(status_code=501, detail="微信网页登录未配置（需要公众号 appid）")

    # Validate redirect_uri against allowed origins
    parsed = urlparse(redirect_uri)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="无效的 redirect_uri")
    redirect_origin = f"{parsed.scheme}://{parsed.netloc}"
    allowed = {o.strip().rstrip("/") for o in settings.cors_origins.split(",") if o.strip() != "*"}
    if allowed and redirect_origin not in allowed:
        raise HTTPException(status_code=403, detail="redirect_uri 不在允许列表中")

    url = get_web_authorize_url(redirect_uri)
    return WeChatQRResponse(authorize_url=url)


@router.post("/bind-wechat", response_model=BindResultResponse)
async def bind_wechat(
    req: WebOAuthRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Bind WeChat account to current logged-in user (via web OAuth code)."""
    try:
        token_data = await exchange_web_code(req.code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    wx_openid = token_data["openid"]
    wx_unionid = token_data.get("unionid")

    # Check if this WeChat is already bound to another user
    existing = await db.execute(
        select(User).where(
            User.wechat_web_openid == wx_openid,
            User.id != user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="该微信已绑定其他账号")

    # Bind
    user.wechat_web_openid = wx_openid
    if wx_unionid and not user.wechat_unionid:
        user.wechat_unionid = wx_unionid

    await db.commit()
    return BindResultResponse(ok=True, message="微信绑定成功")


@router.get("/me", response_model=UserMeResponse)
async def get_me(user: User = Depends(get_current_user)):
    """Get current user info."""
    return UserMeResponse(
        id=str(user.id),
        username=user.username,
        nickname=user.nickname,
        avatar_url=user.avatar_url,
        has_miniapp_wechat=bool(user.wechat_openid),
        has_web_wechat=bool(user.wechat_web_openid),
    )


@router.post("/dev-login", response_model=TokenResponse)
async def dev_login(req: DevLoginRequest, db: AsyncSession = Depends(get_db)):
    """Development login: create or reuse a dev user, no WeChat required."""
    if not settings.debug:
        raise HTTPException(status_code=404, detail="Not found")
    import hashlib

    dev_openid = "dev_" + hashlib.md5(req.nickname.encode()).hexdigest()[:12]
    user = await get_or_create_user(db, dev_openid, nickname=req.nickname)
    await db.commit()
    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token)
