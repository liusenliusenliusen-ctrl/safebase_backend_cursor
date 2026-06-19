import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";

const encoder = new TextEncoder();

function secretKey(): Uint8Array {
  const s = config.jwtSecret.trim();
  if (!s) throw new Error("JWT_SECRET is not configured");
  return encoder.encode(s);
}

export interface AuthTokenPayload {
  sub: string;
  username: string;
}

export async function signAccessToken(
  payload: AuthTokenPayload
): Promise<string> {
  return new SignJWT({ username: payload.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey());
}

export async function verifyAccessToken(
  token: string
): Promise<AuthTokenPayload> {
  const { payload } = await jwtVerify(token, secretKey());
  const sub = payload.sub;
  if (!sub || typeof sub !== "string") {
    throw new Error("Invalid token subject");
  }
  const username =
    typeof payload.username === "string" ? payload.username : "用户";
  return { sub, username };
}
