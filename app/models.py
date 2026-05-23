from datetime import datetime, date
from typing import List, Optional

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from pgvector.sqlalchemy import Vector

from .database import Base


class Profile(Base):
    __tablename__ = "profiles"

    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    content: Mapped[str] = mapped_column(
        Text,
        default="# 核心画像\n尚未生成\n\n## 触发清单\n尚未记录\n\n## 资源库\n尚未记录",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), index=True)
    role: Mapped[str] = mapped_column(
        String(16),
        CheckConstraint("role IN ('user', 'assistant')"),
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(2048), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, index=True
    )


class Summary(Base):
    __tablename__ = "summaries"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), index=True)
    type: Mapped[str] = mapped_column(
        String(16),
        CheckConstraint("type IN ('daily', 'weekly', 'monthly', 'yearly')"),
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    summary_date: Mapped[date] = mapped_column(Date, nullable=False)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(2048), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint("user_id", "type", "summary_date", name="uq_summary_user_type_date"),
    )


class Anchor(Base):
    __tablename__ = "anchors"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(UUID(as_uuid=False), index=True)
    event_name: Mapped[str] = mapped_column(Text, nullable=False)
    initial_thought: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    current_thought: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    evolution_history: Mapped[dict] = mapped_column(JSON, default=list)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(2048), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )
