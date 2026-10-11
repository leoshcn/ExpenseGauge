from fastapi import APIRouter

from app.deps import AnyPrincipal, DbSession, SessionPrincipal
from app.schemas.channel import ChannelCreateIn, ChannelOut, ChannelUpdateIn
from app.services import channels as channel_service

router = APIRouter(tags=["channels"])


@router.get("/channels", response_model=list[ChannelOut])
def list_channels(principal: AnyPrincipal, db: DbSession):
    """Payment channels; agents submit transactions per channel. Open to agent tokens."""
    return channel_service.list_channels(db)


@router.post("/channels", response_model=ChannelOut, status_code=201)
def create_channel(payload: ChannelCreateIn, principal: SessionPrincipal, db: DbSession):
    return channel_service.create_channel(db, payload.name)


@router.patch("/channels/{channel_id}", response_model=ChannelOut)
def rename_channel(
    channel_id: int, payload: ChannelUpdateIn, principal: SessionPrincipal, db: DbSession
):
    return channel_service.rename_channel(db, channel_id, payload.name)
