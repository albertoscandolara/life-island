import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { rateLimit } from '@life-island/be-nest';
import { sessionCookie } from '@life-island/be-nest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthService, type Client, type SessionView } from './auth.service.js';
import { CONFIG, type AuthConfig } from './config.js';

type Request = IncomingMessage & { ip?: string };

/*
 * The sign-in API, at /api/auth/ behind the gateway. Every answer that starts
 * a session sets the cookie; the token never appears in a body or a log.
 */
@Controller()
export class AuthController {
  private readonly loginLimit;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: AuthConfig,
  ) {
    this.loginLimit = rateLimit(config.loginPerMinute);
  }

  /** Who is signed in. Services ask this too (libs/be-nest sign-in.ts). */
  @Get('session')
  async session(@Req() req: Request): Promise<SessionView> {
    const view = await this.auth.session(token(req));
    if (!view) throw new UnauthorizedException('Sign in to continue.');
    return view;
  }

  @Get('setup')
  async setupNeeded(): Promise<{ needed: boolean }> {
    return { needed: await this.auth.setupNeeded() };
  }

  @Post('setup')
  @HttpCode(200)
  async setup(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
    @Body() body: Record<string, unknown>,
  ) {
    await this.limit(req, res);
    const { token: session, user } = await this.auth.setup(
      body ?? {},
      client(req),
    );
    this.setCookie(res, session);
    return { user };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
    @Body() body: Record<string, unknown>,
  ) {
    await this.limit(req, res);
    const result = await this.auth.signIn(body ?? {}, client(req));
    if ('needsCode' in result) return { needsCode: true };
    this.setCookie(res, result.token);
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<void> {
    await this.auth.signOut(token(req));
    this.clearCookie(res);
  }

  @Post('logout-everywhere')
  @HttpCode(204)
  async logoutEverywhere(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
  ): Promise<void> {
    await this.auth.signOutEverywhere(token(req), client(req));
    this.clearCookie(res);
  }

  @Post('password')
  @HttpCode(204)
  async password(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    await this.limit(req, res);
    const { token: session } = await this.auth.changePassword(
      token(req),
      body ?? {},
      client(req),
    );
    this.setCookie(res, session);
  }

  @Post('two-factor/start')
  @HttpCode(200)
  startTwoFactor(@Req() req: Request) {
    return this.auth.startTwoFactor(token(req), client(req));
  }

  @Post('two-factor/confirm')
  @HttpCode(200)
  async confirmTwoFactor(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
    @Body() body: Record<string, unknown>,
  ) {
    await this.limit(req, res);
    return {
      user: await this.auth.confirmTwoFactor(
        token(req),
        body ?? {},
        client(req),
      ),
    };
  }

  @Post('two-factor/disable')
  @HttpCode(200)
  async disableTwoFactor(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
    @Body() body: Record<string, unknown>,
  ) {
    await this.limit(req, res);
    return {
      user: await this.auth.disableTwoFactor(
        token(req),
        body ?? {},
        client(req),
      ),
    };
  }

  @Get('members')
  members(@Req() req: Request) {
    return this.auth.members(token(req));
  }

  @Delete('members/:id')
  @HttpCode(204)
  removeMember(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.auth.removeMember(token(req), id, client(req));
  }

  @Get('invites')
  invites(@Req() req: Request) {
    return this.auth.invites(token(req));
  }

  @Post('invites')
  invite(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.auth.invite(token(req), body ?? {}, client(req));
  }

  @Delete('invites/:id')
  @HttpCode(204)
  cancelInvite(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.auth.cancelInvite(token(req), id, client(req));
  }

  @Get('invite')
  async checkInvite(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
    @Query('token') invite: string,
  ) {
    await this.limit(req, res);
    return this.auth.checkInvite(invite);
  }

  @Post('invite/accept')
  @HttpCode(200)
  async acceptInvite(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
    @Body() body: Record<string, unknown>,
  ) {
    await this.limit(req, res);
    const { token: session, user } = await this.auth.acceptInvite(
      body ?? {},
      client(req),
    );
    this.setCookie(res, session);
    return { user };
  }

  /** The stricter per-address limit of everything that checks a secret. */
  private limit(req: Request, res: ServerResponse): Promise<void> {
    return new Promise((resolve, reject) => {
      const probe = {
        statusCode: 200,
        setHeader: (name: string, value: string) => res.setHeader(name, value),
        end: () =>
          reject(
            new HttpException(
              'Too many attempts. Wait a minute and try again.',
              HttpStatus.TOO_MANY_REQUESTS,
            ),
          ),
      } as unknown as ServerResponse;
      void this.loginLimit(req, probe, () => resolve());
    });
  }

  private cookieName(): string {
    return this.config.cookieSecure ? '__Host-li_session' : 'li_session';
  }

  private setCookie(res: ServerResponse, value: string): void {
    const maxAge = Math.round(this.config.sessionMaxDays * 24 * 3600);
    res.setHeader('Set-Cookie', [
      `${this.cookieName()}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.config.cookieSecure ? '; Secure' : ''}`,
    ]);
  }

  private clearCookie(res: ServerResponse): void {
    res.setHeader('Set-Cookie', [
      `${this.cookieName()}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${this.config.cookieSecure ? '; Secure' : ''}`,
    ]);
  }
}

function token(req: Request): string | null {
  return sessionCookie(req.headers.cookie)?.value ?? null;
}

function client(req: Request): Client {
  const agent = req.headers['user-agent'];
  return {
    ip: req.ip ?? req.socket?.remoteAddress ?? null,
    userAgent: typeof agent === 'string' ? agent : null,
  };
}
