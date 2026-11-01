import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

export interface PublishedArticleSummary {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  coverImageUrl: string | null;
  category: string;
  tags: string;
  authorName: string;
  readTimeMinutes: number;
  viewsCount: number;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface PublishedArticle extends PublishedArticleSummary {
  content: string;
}

@Injectable()
export class ArticlesService {
  constructor(private readonly prisma: PrismaService) {}

  listPublishedArticles() {
    // Team Platform manages editorial content in public.articles. The main
    // Prisma connection uses the jitu_backend schema, so qualify this table.
    return this.prisma.$queryRaw<PublishedArticleSummary[]>`
      SELECT id, title, slug, summary, cover_image_url AS "coverImageUrl",
             category, tags, author_name AS "authorName",
             read_time_minutes AS "readTimeMinutes", views_count AS "viewsCount",
             published_at AS "publishedAt", created_at AS "createdAt"
      FROM public.articles
      WHERE status = 'PUBLISHED'
      ORDER BY published_at DESC NULLS LAST, created_at DESC
    `;
  }

  async getPublishedArticle(slug: string) {
    const rows = await this.prisma.$queryRaw<PublishedArticle[]>`
      SELECT id, title, slug, summary, content,
             cover_image_url AS "coverImageUrl", category, tags,
             author_name AS "authorName", read_time_minutes AS "readTimeMinutes",
             views_count AS "viewsCount", published_at AS "publishedAt",
             created_at AS "createdAt"
      FROM public.articles
      WHERE slug = ${slug} AND status = 'PUBLISHED'
      LIMIT 1
    `;
    const article = rows[0];

    if (!article) throw new NotFoundException('Article not found.');
    return article;
  }
}
