"""Auth routes — login (username+PIN), me, logout. Session = httpOnly cookie.

The login page never fetches a user list: credentials are posted and answered
with a generic error, so the endpoint leaks nothing about which usernames exist.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from lib.auth import (
    SESSION_COOKIE,
    SESSION_TTL_DAYS,
    create_session,
    destroy_session,
    get_current_user,
    user_public,
    verify_pin,
)
from lib.db import db

router = APIRouter()


class LoginIn(BaseModel):
    username: str = Field(min_length=2, max_length=40)
    pin: str = Field(min_length=4, max_length=6)


@router.post("/auth/login")
async def login(input: LoginIn, response: Response):
    user = await db.users.find_one({"username": input.username.strip().lower()})
    if not user or not verify_pin(input.pin, user.get("pin_hash", "")):
        # Generic on purpose — never reveal whether the username or the PIN was wrong.
        raise HTTPException(status_code=401, detail="Username atau PIN salah")
    token, expires = await create_session(user["id"])
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_TTL_DAYS * 86400,
        path="/",
    )
    return await user_public(user)


@router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return await user_public(user)


@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await destroy_session(token)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}
