import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { parseOrThrow } from '@life-island/be-nest';
import {
  approveSuggestionRequestSchema,
  categoryIdSchema,
  createCategoryRequestSchema,
  deleteCategoryQuerySchema,
  listSuggestionsQuerySchema,
  updateCategoryRequestSchema,
  updateSuggestionRequestSchema,
  type CategoryDto,
  type CategoryHierarchyDto,
  type CategorySuggestionDto,
  type ParseQueueDto,
} from '@life-island/contracts';
import { CategoriesService } from './categories.service.js';

@Controller()
export class CategoriesController {
  constructor(
    @Inject(CategoriesService) private readonly categories: CategoriesService,
  ) {}

  @Get('categories')
  list(): Promise<CategoryDto[]> {
    return this.categories.list();
  }

  /** Add a category by hand. */
  @Post('categories')
  create(@Body() body: unknown): Promise<CategoryDto> {
    return this.categories.create(
      parseOrThrow(createCategoryRequestSchema, body),
    );
  }

  /** Ancestors (root first), direct children and all descendants of a category. */
  @Get('categories/:id/hierarchy')
  hierarchy(@Param('id') id: string): Promise<CategoryHierarchyDto> {
    return this.categories.hierarchy(parseOrThrow(categoryIdSchema, id));
  }

  /**
   * Delete a category. Its documents stay (they lose the category, or get its
   * parent with `documents=MOVE_TO_PARENT`); a category with subcategories
   * needs `children=MOVE_TO_PARENT` or `children=MAKE_ROOT`.
   */
  @Delete('categories/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @Query() query: unknown): Promise<void> {
    return this.categories.remove(
      parseOrThrow(categoryIdSchema, id),
      parseOrThrow(deleteCategoryQuerySchema, query),
    );
  }

  /** Edit a category's title, description, template, parent (move it) or dimension. */
  @Patch('categories/:id')
  update(@Param('id') id: string, @Body() body: unknown): Promise<CategoryDto> {
    return this.categories.update(
      parseOrThrow(categoryIdSchema, id),
      parseOrThrow(updateCategoryRequestSchema, body),
    );
  }

  @Get('category-suggestions')
  suggestions(@Query() query: unknown): Promise<CategorySuggestionDto[]> {
    return this.categories.listSuggestions(
      parseOrThrow(listSuggestionsQuerySchema, query),
    );
  }

  /** Edit a pending suggestion: its proposed id, title, description or template. */
  @Patch('category-suggestions/:id')
  updateSuggestion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<CategorySuggestionDto> {
    return this.categories.updateSuggestion(
      id,
      parseOrThrow(updateSuggestionRequestSchema, body),
    );
  }

  /** Saves a suggested category, as proposed or with your edits. */
  @Post('category-suggestions/:id/approve')
  @HttpCode(200)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<CategorySuggestionDto> {
    return this.categories.approve(
      id,
      parseOrThrow(approveSuggestionRequestSchema, body ?? {}),
    );
  }

  @Post('category-suggestions/:id/reject')
  @HttpCode(200)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CategorySuggestionDto> {
    return this.categories.reject(id);
  }

  /** Whether the AI parsing is running, idle or paused (quota, rate limit), and until when. */
  @Get('parse-queue')
  queue(): Promise<ParseQueueDto> {
    return this.categories.queue();
  }
}
