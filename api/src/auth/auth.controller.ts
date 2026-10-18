import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Patch, Post, Req, UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { CurrentUser, Public } from "../common/auth";
import { toUser } from "../common/mappers";
import { DEFAULT_CATEGORIES, moderatorEmails } from "../common/domain";
import { hashPassword, newId, newToken, nowIso, sha256, verifyPassword } from "../common/security";
import { DatabaseService } from "../database/database.module";
import { CURRENCY_CODES } from "../common/currencies";

class RegisterDto {
  @IsString() @IsNotEmpty() @MaxLength(60) firstName!: string;
  @IsString() @IsNotEmpty() @MaxLength(60) lastName!: string;
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @IsString() confirmPassword!: string;
}

class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MaxLength(128) password!: string;
}

class ProfileDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) firstName?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(60) lastName?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsIn(CURRENCY_CODES) currency?: string;
}

class PasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}

class NotificationPrefsDto {
  @IsOptional() @IsBoolean() budgetAlerts?: boolean;
  @IsOptional() @IsBoolean() upcomingBills?: boolean;
  @IsOptional() @IsBoolean() savingsMilestones?: boolean;
  @IsOptional() @IsBoolean() communityReplies?: boolean;
  @IsOptional() @IsBoolean() marketplaceMessages?: boolean;
}

class DeleteRequestDto {
  @IsIn(["DELETE"]) confirmation!: string;
}

@Controller()
export class AuthController {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  private findUser(id: string) {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, any>;
  }

  private openSession(userId: string): string {
    const token = newToken();
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)").run(sha256(token), userId, nowIso());
    return token;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("auth/register")
  async register(@Body() dto: RegisterDto) {
    if (dto.password !== dto.confirmPassword) throw new BadRequestException("Passwords do not match");
    const email = dto.email.toLowerCase();
    const exists = this.db.prepare("SELECT 1 FROM users WHERE email = ?").get(email);
    if (exists) throw new BadRequestException("This email cannot be used");

    const id = newId();
    const role = moderatorEmails().includes(email) ? "moderator" : "member";
    const passwordHash = await hashPassword(dto.password);
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO users (id, first_name, last_name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, dto.firstName.trim(), dto.lastName.trim(), email, passwordHash, role, nowIso());
      const insertCategory = this.db.prepare("INSERT INTO categories (id, user_id, name) VALUES (?, ?, ?)");
      for (const name of DEFAULT_CATEGORIES) insertCategory.run(newId(), id, name);
    })();

    const token = this.openSession(id);
    return { token, user: toUser(this.findUser(id)) };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("auth/login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    const row = this.db.prepare("SELECT * FROM users WHERE email = ?").get(dto.email.toLowerCase()) as Record<string, any> | undefined;
    const valid = row && (await verifyPassword(dto.password, row.password_hash));
    if (!row || !valid) throw new UnauthorizedException("Invalid email or password");
    const token = this.openSession(row.id);
    return { token, user: toUser(row) };
  }

  @Post("auth/logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Req() req: any) {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(req.sessionTokenHash);
  }

  @Get("auth/me")
  me(@CurrentUser() user: { id: string }) {
    return toUser(this.findUser(user.id));
  }

  @Patch("users/me")
  updateProfile(@CurrentUser() user: { id: string }, @Body() dto: ProfileDto) {
    const email = dto.email?.toLowerCase();
    if (email && this.db.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").get(email, user.id)) {
      throw new BadRequestException("This email cannot be used");
    }
    this.db.prepare(`
      UPDATE users SET
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        email = COALESCE(?, email),
        currency = COALESCE(?, currency)
      WHERE id = ?`).run(dto.firstName?.trim() ?? null, dto.lastName?.trim() ?? null, email ?? null, dto.currency ?? null, user.id);
    return toUser(this.findUser(user.id));
  }

  /** Changing the password revokes every other session of the user. */
  @Post("users/me/password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@CurrentUser() user: { id: string }, @Req() req: any, @Body() dto: PasswordDto) {
    const row = this.findUser(user.id);
    if (!(await verifyPassword(dto.currentPassword, row.password_hash))) {
      throw new ForbiddenException("Current password is incorrect");
    }
    const newHash = await hashPassword(dto.newPassword);
    this.db.transaction(() => {
      this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, user.id);
      this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(user.id, req.sessionTokenHash);
    })();
  }

  @Patch("users/me/notifications")
  updateNotifications(@CurrentUser() user: { id: string }, @Body() dto: NotificationPrefsDto) {
    const map: Record<string, string> = {
      budgetAlerts: "notify_budget_alerts",
      upcomingBills: "notify_upcoming_bills",
      savingsMilestones: "notify_savings_milestones",
      communityReplies: "notify_community_replies",
      marketplaceMessages: "notify_marketplace_messages",
    };
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) this.db.prepare(`UPDATE users SET ${map[key]} = ? WHERE id = ?`).run(value ? 1 : 0, user.id);
    }
    return toUser(this.findUser(user.id));
  }

  /** Records a deletion request for review; nothing is deleted here. */
  @Post("users/me/delete-request")
  @HttpCode(HttpStatus.ACCEPTED)
  requestDeletion(@CurrentUser() user: { id: string }, @Body() _dto: DeleteRequestDto) {
    const at = nowIso();
    this.db.prepare("UPDATE users SET deletion_requested_at = ? WHERE id = ?").run(at, user.id);
    return { deletionRequestedAt: at };
  }
}
