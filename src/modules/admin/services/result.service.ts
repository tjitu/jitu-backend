import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';

@Injectable()
export class AdminTryoutResultService {
  constructor(private readonly prisma: PrismaService) {}

  async getLeaderboard(tryoutId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.tryOutAttempt.findMany({
        where: {
          tryOutId: tryoutId,
          status: 'FINISHED',
        },
        orderBy: { totalScore: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              name: true,
              email: true,
              image: true,
              target: true,
            },
          },
        },
      }),
      this.prisma.tryOutAttempt.count({
        where: { tryOutId: tryoutId, status: 'FINISHED' },
      }),
    ]);

    // Tambahkan posisi rank (1, 2, 3...)
    const rankedData = data.map((item, index) => ({
      ...item,
      rank: skip + index + 1,
    }));

    return {
      data: rankedData,
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit),
      },
    };
  }

  async getTryoutStats(tryoutId: string) {
    const tryout = await this.prisma.tryOut.findUnique({
      where: { id: tryoutId },
      select: { title: true },
    });

    if (!tryout) throw new NotFoundException('Tryout tidak ditemukan');

    const aggregate = await this.prisma.tryOutAttempt.aggregate({
      where: { tryOutId: tryoutId, status: 'FINISHED' },
      _avg: { totalScore: true },
      _max: { totalScore: true },
      _min: { totalScore: true },
      _count: { id: true },
    });

    // Distribusi Nilai (Kelompokkan skor)
    const attempts = await this.prisma.tryOutAttempt.findMany({
      where: { tryOutId: tryoutId, status: 'FINISHED' },
      select: { totalScore: true },
    });

    const distribution = {
      under400: attempts.filter((a) => a.totalScore < 400).length,
      range400to600: attempts.filter(
        (a) => a.totalScore >= 400 && a.totalScore < 600,
      ).length,
      range600to800: attempts.filter(
        (a) => a.totalScore >= 600 && a.totalScore < 800,
      ).length,
      above800: attempts.filter((a) => a.totalScore >= 800).length,
    };

    return {
      title: tryout.title,
      totalParticipants: aggregate._count.id,
      averageScore: aggregate._avg.totalScore || 0,
      highestScore: aggregate._max.totalScore || 0,
      lowestScore: aggregate._min.totalScore || 0,
      distribution,
    };
  }

  async exportResults(tryoutId: string, type = 'all') {
    const where: any = { tryOutId: tryoutId };
    if (type === 'finished') {
      where.status = 'FINISHED';
    }

    const data = await this.prisma.tryOutAttempt.findMany({
      where,
      orderBy:
        type === 'finished'
          ? { totalScore: 'desc' }
          : { startedAt: 'desc' },
      include: {
        user: {
          select: {
            name: true,
            email: true,
            target: true,
          },
        },
      },
    });

    return data.map((item, index) => ({
      No: index + 1,
      Nama: item.user?.name || 'Peserta',
      Email: item.user?.email || '-',
      Target: item.user?.target || '-',
      Status:
        item.status === 'FINISHED'
          ? 'Selesai'
          : item.status === 'IN_PROGRESS'
            ? 'Sedang Mengerjakan'
            : 'Belum Mulai',
      Skor: item.status === 'FINISHED' ? Math.round(item.totalScore) : '-',
      Waktu_Pendaftaran: item.startedAt,
      Waktu_Selesai: item.finishedAt || '-',
    }));
  }

  async getRegistrants(
    tryoutId: string,
    page = 1,
    limit = 50,
    status?: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED' | 'ALL',
    search?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = { tryOutId: tryoutId };

    if (status && status !== 'ALL') {
      where.status = status;
    }

    if (search && search.trim()) {
      where.user = {
        OR: [
          { name: { contains: search.trim(), mode: 'insensitive' } },
          { email: { contains: search.trim(), mode: 'insensitive' } },
        ],
      };
    }

    const [data, total, statusCounts] = await Promise.all([
      this.prisma.tryOutAttempt.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              target: true,
            },
          },
        },
      }),
      this.prisma.tryOutAttempt.count({ where }),
      this.prisma.tryOutAttempt.groupBy({
        by: ['status'],
        where: { tryOutId: tryoutId },
        _count: { id: true },
      }),
    ]);

    const counts = {
      all: 0,
      notStarted: 0,
      inProgress: 0,
      finished: 0,
    };

    statusCounts.forEach((sc) => {
      counts.all += sc._count.id;
      if (sc.status === 'NOT_STARTED') counts.notStarted = sc._count.id;
      else if (sc.status === 'IN_PROGRESS') counts.inProgress = sc._count.id;
      else if (sc.status === 'FINISHED') counts.finished = sc._count.id;
    });

    return {
      data,
      counts,
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit) || 1,
      },
    };
  }
}
