import { Controller, Get, Param } from '@nestjs/common';
import { ArticlesService } from './articles.service';

@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  listPublishedArticles() {
    return this.articlesService.listPublishedArticles();
  }

  @Get(':slug')
  getPublishedArticle(@Param('slug') slug: string) {
    return this.articlesService.getPublishedArticle(slug);
  }
}
