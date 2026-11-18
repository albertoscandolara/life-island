import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import type {
  DigestDto,
  DigestStatusDto,
  DigestTestDto,
} from '@life-island/contracts';
import { DigestService } from './digest.service.js';

/** The email digest: how it is set, a preview, and a test sent now. */
@Controller('digest')
export class DigestController {
  constructor(@Inject(DigestService) private readonly digest: DigestService) {}

  @Get()
  status(): Promise<DigestStatusDto> {
    return this.digest.status();
  }

  @Get('preview')
  preview(): Promise<DigestDto> {
    return this.digest.preview();
  }

  @Post('test')
  @HttpCode(200)
  test(): Promise<DigestTestDto> {
    return this.digest.test();
  }
}
