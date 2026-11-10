import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  importSettingsRequestSchema,
  setAiToolRequestSchema,
  setAppSettingRequestSchema,
  type AppSettingValue,
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

  /** Every value you set, for a backup file. */
  @Get('settings')
  export(): Promise<Record<string, AppSettingValue>> {
    return this.settings.export();
  }

  /** Sets many values at once (a backup you import); null resets one. All or nothing. */
  @Put('settings')
  async import(@Body() body: unknown): Promise<{ imported: number }> {
    return {
      imported: await this.settings.import(
        parseOrThrow(importSettingsRequestSchema, body).values,
      ),
    };
  }

  /** Puts a setting (an AI tool's switch or model included) back to its default. */
  @Delete('settings/:key')
  @HttpCode(204)
  reset(@Param('key') key: string): Promise<void> {
    return this.settings.reset(key);
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
