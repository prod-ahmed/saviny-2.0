import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DatabaseService } from "../database/database.module";
import { toUser } from "./mappers";
import { sha256 } from "./security";

export const IS_PUBLIC = "isPublic";
/** Reachable without a session. A valid token is still attached to req.user when present. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest().user,
);

/** Resolves a session token to its user, or null when the session was revoked or never existed. */
export function userFromToken(db: DatabaseService, token: string): { user: ReturnType<typeof toUser>; tokenHash: string } | null {
  const hash = sha256(token);
  const row = db.db
    .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
    .get(hash) as Record<string, any> | undefined;
  return row ? { user: toUser(row), tokenHash: hash } : null;
}

/** Global guard: resolves Bearer tokens to live sessions and enforces authentication on non-public routes. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly database: DatabaseService, private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

    const session = token ? userFromToken(this.database, token) : null;
    if (session) {
      req.user = session.user;
      req.sessionTokenHash = session.tokenHash;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (!isPublic && !req.user) throw new UnauthorizedException();
    return true;
  }
}
