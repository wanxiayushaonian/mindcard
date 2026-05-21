from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.utils.auth import create_access_token, get_or_create_user
from app.utils.wechat import code_to_openid

router = APIRouter()


class WeChatLoginRequest(BaseModel):
    code: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/wechat-login", response_model=TokenResponse)
async def wechat_login(req: WeChatLoginRequest, db: AsyncSession = Depends(get_db)):
    """WeChat mini-program login: exchange code for JWT."""
    try:
        wx_data = await code_to_openid(req.code)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    openid = wx_data["openid"]
    user = await get_or_create_user(db, openid)
    await db.commit()

    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token)


class WebLoginRequest(BaseModel):
    code: str  # WeChat公众号 OAuth code


@router.post("/web-login", response_model=TokenResponse)
async def web_login(req: WebLoginRequest, db: AsyncSession = Depends(get_db)):
    """Web端扫码登录 via WeChat OAuth."""
    # TODO: implement WeChat公众号 OAuth flow
    raise HTTPException(status_code=501, detail="Web login not yet implemented")


class DevLoginRequest(BaseModel):
    nickname: str = "Web用户"


@router.post("/dev-login", response_model=TokenResponse)
async def dev_login(req: DevLoginRequest, db: AsyncSession = Depends(get_db)):
    """Development login: create or reuse a dev user, no WeChat required."""
    import hashlib

    dev_openid = "dev_" + hashlib.md5(req.nickname.encode()).hexdigest()[:12]
    user = await get_or_create_user(db, dev_openid, nickname=req.nickname)
    await db.commit()
    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token)
