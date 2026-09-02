import os
from datetime import datetime, timedelta
import bcrypt
from jose import jwt, JWTError

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-secret-change-this")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24

# bcrypt has a hard 72-byte limit on input; truncate defensively so long
# passwords don't raise instead of just being capped.
MAX_PASSWORD_BYTES = 72


def hash_password(password):
    pw_bytes = password.encode("utf-8")[:MAX_PASSWORD_BYTES]
    hashed = bcrypt.hashpw(pw_bytes, bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(plain_password, hashed_password):
    pw_bytes = plain_password.encode("utf-8")[:MAX_PASSWORD_BYTES]
    return bcrypt.checkpw(pw_bytes, hashed_password.encode("utf-8"))


def create_access_token(email, role="student"):
    """role is embedded in the token (not just looked up from the DB on every
    request) so teacher-only endpoints can check it directly off the decoded
    token without an extra DB round-trip per request."""
    expire = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    payload = {"sub": email, "role": role, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token):
    """Returns {"email": ..., "role": ...} or None if the token is missing/invalid/expired.
    Tokens issued before the 'role' claim existed decode with role defaulting to 'student'."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email:
            return None
        return {"email": email, "role": payload.get("role", "student")}
    except JWTError:
        return None
