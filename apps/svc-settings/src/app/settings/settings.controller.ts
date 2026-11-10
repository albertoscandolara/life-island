import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  setAiToolRequestSchema,
  setAppSettingRequestSchema,
  type SettingsOverviewDto,
} from '@life-island/contracts';
import { SettingsService } from './settings.service.js';

@Controller()
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Every AI tool with its switch, cost and request, and every app setting. */
  @Get('overview')
  overview(): Promise<SettingsOverviewDto> {
    return this.settings.overview();
  }

  /** Turns one AI tool on or off. */
  @Put('ai-tools/:id')
  @HttpCode(204)
  setAiTool(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    return this.settings.setAiTool(
      id,
      parseOrThrow(setAiToolRequestSchema, body).enabled,
    );
  }

  /** Changes an app setting, e.g. `ai.enabled`, the master switch of every AI tool. */
  @Put('settings/:key')
  @HttpCode(204)
  setSetting(@Param('key') key: string, @Body() body: unknown): Promise<void> {
    return this.settings.set(
      key,
      parseOrThrow(setAppSettingRequestSchema, body).value,
    );
  }
}
