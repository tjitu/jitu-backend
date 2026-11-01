import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ArticlesService {
  constructor(private readonly prisma: PrismaService) {}

  listPublishedArticles() {
    return this.prisma.article.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        slug: true,
        summary: true,
        coverImageUrl: true,
        category: true,
        tags: true,
        authorName: true,
        readTimeMinutes: true,
        viewsCount: true,
        publishedAt: true,
        createdAt: true,
      },
    });
  }

  async getPublishedArticle(slug: string) {
    const article = await this.prisma.article.findFirst({
      where: { slug, status: 'PUBLISHED' },
      select: {
        id: true,
        title: true,
        slug: true,
        summary: true,
        content: true,
        coverImageUrl: true,
        category: true,
        tags: true,
        authorName: true,
        readTimeMinutes: true,
        viewsCount: true,
        publishedAt: true,
        createdAt: true,
      },
    });

    if (!article) throw new NotFoundException('Article not found.');
    return article;
  }
}
