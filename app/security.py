from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
from jose import JWTError, jwt

from .config import get_settings
from .schemas import TokenPayload


# bcrypt 只使用密码的前 72 字节，超出会报错；直接用 bcrypt 库避免 passlib 内部检测触发的 ValueError
BCRYPT_MAX_PASSWORD_BYTES = 72

settings = get_settings()


def _password_bytes(s: str) -> bytes:
    b = s.encode("utf-8")
    if len(b) > BCRYPT_MAX_PASSWORD_BYTES:
        b = b[:BCRYPT_MAX_PASSWORD_BYTES]
    return b


def hash_password(password: str) -> str:
    hashed = bcrypt.hashpw(_password_bytes(password), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        _password_bytes(plain_password),
        hashed_password.encode("utf-8"),
    )


def create_access_token(subject: str, expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta is None:
        expires_delta = timedelta(minutes=settings.access_token_expires_minutes)
    expire = datetime.now(timezone.utc) + expires_delta
    to_encode: dict[str, Any] = {"sub": subject, "exp": expire}
    return jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> Optional[TokenPayload]:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        return TokenPayload(**payload)
    except JWTError:
        return None

