from app.schemas.common import Name, RequestSchema, Schema


class ChannelCreateIn(RequestSchema):
    name: Name


class ChannelUpdateIn(RequestSchema):
    name: Name


class ChannelOut(Schema):
    """A payment channel: where transactions come from. Agents submit per channel."""

    id: int
    name: str
